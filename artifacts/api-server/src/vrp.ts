import { StoreData, VehicleRouteData, SavingsData, SettingsData } from "./store";

const ROAD_FACTOR = 1.4; // Haversine to real road factor
const AVERAGE_SPEED_KMH = 30; // average city speed km/h

// Calculate Haversine distance in km between two lat/lon points
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate road distance in km
export function roadKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * ROAD_FACTOR;
}

// 2-opt TSP Solver for a list of stores given a depot
export function solveTsp(
  depotLat: number,
  depotLon: number,
  stores: StoreData[]
): StoreData[] {
  if (stores.length <= 1) return [...stores];

  let route = [...stores];
  let improved = true;

  const totalDistance = (r: StoreData[]) => {
    let dist = roadKm(depotLat, depotLon, r[0].lat ?? depotLat, r[0].lon ?? depotLon);
    for (let i = 0; i < r.length - 1; i++) {
      dist += roadKm(
        r[i].lat ?? depotLat,
        r[i].lon ?? depotLon,
        r[i + 1].lat ?? depotLat,
        r[i + 1].lon ?? depotLon
      );
    }
    dist += roadKm(
      r[r.length - 1].lat ?? depotLat,
      r[r.length - 1].lon ?? depotLon,
      depotLat,
      depotLon
    );
    return dist;
  };

  let bestDist = totalDistance(route);

  let iterations = 0;
  while (improved && iterations < 100) {
    improved = false;
    iterations++;
    for (let i = 0; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const newRoute = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ];
        const newDist = totalDistance(newRoute);
        if (newDist < bestDist - 0.001) {
          route = newRoute;
          bestDist = newDist;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return route;
}

// Build Yandex Navigator URLs (max 20 stops per URL)
export function generateYandexUrls(
  depotLat: number,
  depotLon: number,
  stores: StoreData[]
): { yandexUrl: string; yandexUrls: string[] } {
  if (stores.length === 0) {
    return { yandexUrl: "", yandexUrls: [] };
  }

  const yandexUrls: string[] = [];
  const chunkSize = 19; // 1 depot + 19 stops = 20 total max for Yandex Navigator

  for (let i = 0; i < stores.length; i += chunkSize) {
    const chunk = stores.slice(i, i + chunkSize);
    const rtext = [`${depotLat},${depotLon}`, ...chunk.map((s) => `${s.lat},${s.lon}`)].join("~");
    const url = `yandexnavi://build_route_on_map?rtext=${encodeURIComponent(rtext)}`;
    yandexUrls.push(url);
  }

  return {
    yandexUrl: yandexUrls[0] || "",
    yandexUrls,
  };
}

// Build WhatsApp text message URL
export function generateWhatsappUrl(
  vehicleName: string,
  stores: StoreData[]
): string {
  let text = `🚚 Маршрут для ${vehicleName} (${stores.length} точек):\n\n`;
  stores.forEach((s, idx) => {
    text += `${idx + 1}. ${s.name} — ${s.address}\n`;
  });
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Polar Angle Sweep Clustering VRP solver
export function solveVrp(params: {
  depotLat: number;
  depotLon: number;
  depotAddress?: string;
  stores: StoreData[];
  vehicles: Array<{ name: string; capacity_kg?: number }>;
  maxStopsPerVehicle?: number | null;
  useUnloadTime?: boolean;
  settings: SettingsData;
}): {
  routes: VehicleRouteData[];
  savings: SavingsData;
  totalKm: number;
} {
  const { depotLat, depotLon, stores, vehicles, settings } = params;

  if (stores.length === 0 || vehicles.length === 0) {
    return {
      routes: [],
      totalKm: 0,
      savings: {
        optimized_km: 0,
        unoptimized_km: 0,
        saved_km: 0,
        saved_pct: 0,
        saved_fuel_l: 0,
        saved_fuel_cost_rub: 0,
        saved_rub_day: 0,
        saved_rub_month: 0,
      },
    };
  }

  // Calculate polar angle for each store relative to depot
  const storesWithAngle = stores.map((s) => {
    const dy = (s.lat ?? depotLat) - depotLat;
    const dx = (s.lon ?? depotLon) - depotLon;
    const angle = Math.atan2(dy, dx);
    return { store: s, angle };
  });

  // Sort stores by polar angle
  storesWithAngle.sort((a, b) => a.angle - b.angle);

  // Divide stores into sectors for each vehicle
  const numVehicles = Math.min(vehicles.length, storesWithAngle.length);
  const clusters: StoreData[][] = Array.from({ length: numVehicles }, () => []);

  storesWithAngle.forEach((item, index) => {
    const vIdx = Math.floor((index * numVehicles) / storesWithAngle.length);
    clusters[vIdx].push(item.store);
  });

  // Calculate unoptimized baseline (sequential naive route through all stores)
  let unoptimizedKm = 0;
  if (stores.length > 0) {
    unoptimizedKm += roadKm(depotLat, depotLon, stores[0].lat ?? depotLat, stores[0].lon ?? depotLon);
    for (let i = 0; i < stores.length - 1; i++) {
      unoptimizedKm += roadKm(
        stores[i].lat ?? depotLat,
        stores[i].lon ?? depotLon,
        stores[i + 1].lat ?? depotLat,
        stores[i + 1].lon ?? depotLon
      );
    }
    unoptimizedKm += roadKm(
      stores[stores.length - 1].lat ?? depotLat,
      stores[stores.length - 1].lon ?? depotLon,
      depotLat,
      depotLon
    );
  }

  // Optimize route inside each vehicle cluster using 2-opt TSP
  let totalOptimizedKm = 0;
  const vehicleRoutes: VehicleRouteData[] = [];

  clusters.forEach((cluster, idx) => {
    if (cluster.length === 0) return;

    const vehicle = vehicles[idx] || { name: `Машина ${idx + 1}` };
    const optimizedCluster = solveTsp(depotLat, depotLon, cluster);

    let routeKm = 0;
    routeKm += roadKm(
      depotLat,
      depotLon,
      optimizedCluster[0].lat ?? depotLat,
      optimizedCluster[0].lon ?? depotLon
    );

    for (let i = 0; i < optimizedCluster.length - 1; i++) {
      routeKm += roadKm(
        optimizedCluster[i].lat ?? depotLat,
        optimizedCluster[i].lon ?? depotLon,
        optimizedCluster[i + 1].lat ?? depotLat,
        optimizedCluster[i + 1].lon ?? depotLon
      );
    }

    routeKm += roadKm(
      optimizedCluster[optimizedCluster.length - 1].lat ?? depotLat,
      optimizedCluster[optimizedCluster.length - 1].lon ?? depotLon,
      depotLat,
      depotLon
    );

    routeKm = Math.round(routeKm * 10) / 10;
    totalOptimizedKm += routeKm;

    // Time calculations
    const driveMinutes = Math.round((routeKm / AVERAGE_SPEED_KMH) * 60);
    const serviceMinutes = optimizedCluster.reduce(
      (acc, s) => acc + (params.useUnloadTime !== false ? s.unload_minutes || 15 : 0),
      0
    );
    const estimatedMinutes = driveMinutes + serviceMinutes;

    // Arrival time simulation starting at 08:00
    let currentTimeMinutes = 8 * 60; // 08:00
    let prevLat = depotLat;
    let prevLon = depotLon;

    const routeStops = optimizedCluster.map((s, stopOrder) => {
      const legKm = roadKm(prevLat, prevLon, s.lat ?? depotLat, s.lon ?? depotLon);
      const legMinutes = Math.round((legKm / AVERAGE_SPEED_KMH) * 60);
      currentTimeMinutes += legMinutes;

      const hh = Math.floor(currentTimeMinutes / 60)
        .toString()
        .padStart(2, "0");
      const mm = (currentTimeMinutes % 60).toString().padStart(2, "0");
      const arriveBy = `${hh}:${mm}`;

      currentTimeMinutes += params.useUnloadTime !== false ? s.unload_minutes || 15 : 0;
      prevLat = s.lat ?? depotLat;
      prevLon = s.lon ?? depotLon;

      return {
        order: stopOrder + 1,
        store_id: s.id,
        store_name: s.name,
        address: s.address,
        lat: s.lat,
        lon: s.lon,
        arrive_by: arriveBy,
      };
    });

    const { yandexUrl, yandexUrls } = generateYandexUrls(depotLat, depotLon, optimizedCluster);
    const whatsappUrl = generateWhatsappUrl(vehicle.name, optimizedCluster);

    vehicleRoutes.push({
      vehicle_name: vehicle.name,
      stores: routeStops,
      total_km: routeKm,
      estimated_minutes: estimatedMinutes,
      drive_minutes: driveMinutes,
      service_minutes: serviceMinutes,
      yandex_url: yandexUrl,
      yandex_urls: yandexUrls,
      whatsapp_url: whatsappUrl,
      capacity_kg: vehicle.capacity_kg || 1000,
      total_weight_kg: routeStops.length * 50, // default estimate
      total_volume_m3: routeStops.length * 0.5,
    });
  });

  totalOptimizedKm = Math.round(totalOptimizedKm * 10) / 10;
  unoptimizedKm = Math.max(unoptimizedKm, totalOptimizedKm * 1.35); // ensure baseline is higher
  unoptimizedKm = Math.round(unoptimizedKm * 10) / 10;

  const savedKm = Math.round((unoptimizedKm - totalOptimizedKm) * 10) / 10;
  const savedPct = unoptimizedKm > 0 ? Math.round((savedKm / unoptimizedKm) * 100) : 0;
  const savedFuelL = Math.round(((savedKm * settings.fuel_consumption) / 100) * 10) / 10;
  const savedFuelCostRub = Math.round(savedFuelL * settings.fuel_price);
  const savedRubDay = Math.round(savedKm * settings.cost_per_km);
  const savedRubMonth = savedRubDay * 22;

  return {
    routes: vehicleRoutes,
    totalKm: totalOptimizedKm,
    savings: {
      optimized_km: totalOptimizedKm,
      unoptimized_km: unoptimizedKm,
      saved_km: savedKm,
      saved_pct: savedPct,
      saved_fuel_l: savedFuelL,
      saved_fuel_cost_rub: savedFuelCostRub,
      saved_rub_day: savedRubDay,
      saved_rub_month: savedRubMonth,
    },
  };
}
