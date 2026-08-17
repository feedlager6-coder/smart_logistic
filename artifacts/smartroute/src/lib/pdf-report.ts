import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export interface PdfReportExecution {
  visit_order: number;
  store_name: string;
  store_client?: string;
  address?: string;
  products?: unknown;
  quantity?: number;
  actual_qty?: number | string;
  amount_rub?: number | null;
  status: string;
  payment_method?: string;
  payment_status?: string;
  driver_comment?: string;
  is_remote_completion?: boolean;
  completion_distance_meters?: number | null;
  delivered_at?: string;
  updated_at?: string;
}

export interface PdfReportAssignment {
  id?: number;
  vehicle_name?: string;
  driver_name?: string;
  driver_phone?: string;
  total_points?: number;
  completed_points?: number;
  status?: string;
}

const statusLabels: Record<string, string> = {
  planned: "Ожидает",
  delivered: "Доставлено",
  partial: "Частично",
  failed: "Отказ",
  rescheduled: "Перенос",
};

const paymentLabels: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  none: "Без оплаты",
};

function formatProductsLine(products: unknown): string {
  if (!products) return "";
  if (typeof products === "string") return products.trim();
  if (Array.isArray(products)) {
    return products
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          const p = item as { name?: string; quantity?: number; count?: number; unit?: string };
          const name = p.name || "";
          const qty = p.quantity ?? p.count ?? "";
          const unit = p.unit ? ` ${p.unit}` : " шт.";
          return qty !== "" ? `${name} (${qty}${unit})` : name;
        }
        return String(item);
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

export async function generateShiftPdfReport({
  assignment,
  executions,
  date,
}: {
  assignment: PdfReportAssignment;
  executions: PdfReportExecution[];
  date?: string;
}): Promise<void> {
  const reportDate = date || new Date().toLocaleDateString("ru-RU");
  const isShiftClosed =
    assignment.status === "completed" ||
    (executions.length > 0 &&
      executions.every((e) =>
        ["delivered", "partial", "failed", "rescheduled"].includes(e.status)
      ));

  // Compute cash & payment metrics
  let totalCashSum = 0;
  let cashPaidCount = 0;
  let cashUnspecifiedCount = 0;

  let totalCardSum = 0;
  let cardPaidCount = 0;
  let cardUnspecifiedCount = 0;

  let totalTransferSum = 0;
  let transferPaidCount = 0;
  let transferUnspecifiedCount = 0;

  let totalNotPaidSum = 0;
  let notPaidCount = 0;

  let freeOrdersCount = 0;
  let totalDeliveredQty = 0;
  let totalPlanQty = 0;
  let totalShortfallQty = 0;

  let deliveredCount = 0;
  let partialCount = 0;
  let failedCount = 0;
  let rescheduledCount = 0;

  executions.forEach((e) => {
    const planQty = Number(e.quantity) || 0;
    totalPlanQty += planQty;

    const hasFixedAmount = typeof e.amount_rub === "number" && e.amount_rub > 0;
    const amountVal = hasFixedAmount ? e.amount_rub! : 0;

    if (e.status === "delivered") {
      deliveredCount++;
      const act = e.actual_qty !== undefined && e.actual_qty !== "" ? Number(e.actual_qty) : planQty;
      totalDeliveredQty += act;
      totalShortfallQty += Math.max(0, planQty - act);
    } else if (e.status === "partial") {
      partialCount++;
      const act = e.actual_qty !== undefined && e.actual_qty !== "" ? Number(e.actual_qty) : 0;
      totalDeliveredQty += act;
      totalShortfallQty += Math.max(0, planQty - act);
    } else if (e.status === "failed") {
      failedCount++;
      totalShortfallQty += planQty;
    } else if (e.status === "rescheduled") {
      rescheduledCount++;
      totalShortfallQty += planQty;
    }

    if (e.payment_method === "none") {
      freeOrdersCount++;
    } else if (e.payment_status === "paid") {
      if (e.payment_method === "cash") {
        if (hasFixedAmount) {
          totalCashSum += amountVal;
          cashPaidCount++;
        } else {
          cashUnspecifiedCount++;
        }
      } else if (e.payment_method === "card") {
        if (hasFixedAmount) {
          totalCardSum += amountVal;
          cardPaidCount++;
        } else {
          cardUnspecifiedCount++;
        }
      } else if (e.payment_method === "transfer") {
        if (hasFixedAmount) {
          totalTransferSum += amountVal;
          transferPaidCount++;
        } else {
          transferUnspecifiedCount++;
        }
      }
    } else if (e.payment_status === "not_paid") {
      if (hasFixedAmount) {
        totalNotPaidSum += amountVal;
      }
      notPaidCount++;
    }
  });

  const totalCollectedFixedSum = totalCashSum + totalCardSum + totalTransferSum;
  const totalUnspecifiedPaidCount = cashUnspecifiedCount + cardUnspecifiedCount + transferUnspecifiedCount;

  let container: HTMLDivElement | null = null;
  try {
    container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "794px"; // Standard A4 at 96 DPI
    container.style.backgroundColor = "#ffffff";
    container.style.color = "#0f172a";
    container.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    container.style.padding = "32px 36px";
    container.style.boxSizing = "border-box";
    container.style.zIndex = "-999";

    const rowsHtml = executions.map((e) => {
      const isComplete = e.status === "delivered";
      const isPartial = e.status === "partial";
      const isFailed = e.status === "failed";
      const isRescheduled = e.status === "rescheduled";

      const hasFixedAmount = typeof e.amount_rub === "number" && e.amount_rub > 0;
      const statusText = statusLabels[e.status] || e.status;
      const statusBg = isComplete ? "#dcfce7" : isPartial ? "#fef3c7" : isFailed ? "#fee2e2" : isRescheduled ? "#f3e8ff" : "#f1f5f9";
      const statusColor = isComplete ? "#166534" : isPartial ? "#92400e" : isFailed ? "#991b1b" : isRescheduled ? "#6b21a8" : "#475569";
      
      const paymentMethodText = paymentLabels[e.payment_method || ""] || "—";
      const isPaid = e.payment_status === "paid";
      const isNone = e.payment_method === "none";

      let amountDisplay = "";
      if (isNone) {
        amountDisplay = "<span style='color:#94a3b8;'>Без оплаты</span>";
      } else if (hasFixedAmount) {
        amountDisplay = `<span style='font-weight:700;'>${e.amount_rub!.toLocaleString("ru-RU")} ₽</span>`;
      } else {
        amountDisplay = "<span style='color:#64748b; font-style:italic;'>По накладной*</span>";
      }

      let paymentStatusText = "";
      if (isNone) {
        paymentStatusText = "<span style='color:#64748b;'>Договор</span>";
      } else if (isPaid) {
        paymentStatusText = hasFixedAmount
          ? "<span style='color:#16a34a; font-weight:bold;'>Оплачено</span>"
          : "<span style='color:#16a34a; font-weight:bold;'>Оплачено (по накладной)</span>";
      } else {
        paymentStatusText = "<span style='color:#b45309;'>Не оплачено</span>";
      }

      const prods = formatProductsLine(e.products) || "Товары по накладной";

      return `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 6px 4px; text-align: center; font-weight: bold; color: #64748b; vertical-align: top;">${e.visit_order}</td>
          <td style="padding: 6px 6px; font-weight: 600; color: #0f172a; vertical-align: top;">
            ${e.store_name}
            ${e.store_client ? `<div style="font-size: 10px; color: #64748b; font-weight: normal;">${e.store_client}</div>` : ""}
          </td>
          <td style="padding: 6px 6px; color: #334155; vertical-align: top; max-width: 160px; word-break: break-word;">${e.address || "—"}</td>
          <td style="padding: 6px 6px; color: #0f172a; vertical-align: top; max-width: 140px; word-break: break-word;">${prods}</td>
          <td style="padding: 6px 6px; text-align: right; vertical-align: top; white-space: nowrap;">${amountDisplay}</td>
          <td style="padding: 6px 6px; vertical-align: top; text-align: center;">
            <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; background-color: ${statusBg}; color: ${statusColor}; white-space: nowrap;">
              ${statusText}
            </span>
            ${e.is_remote_completion ? `<div style="font-size: 9px; color: #d97706; font-weight: bold; margin-top: 2px;">⚠️ Дистанц.</div>` : ""}
          </td>
          <td style="padding: 6px 6px; vertical-align: top; font-size: 10px;">
            <div style="font-weight: 600; color: #0f172a;">${paymentMethodText}</div>
            <div style="font-size: 9.5px; margin-top: 1px;">${paymentStatusText}</div>
          </td>
          <td style="padding: 6px 6px; color: #475569; font-size: 10px; vertical-align: top; font-style: italic; max-width: 110px; word-break: break-word;">
            ${e.driver_comment ? `«${e.driver_comment}»` : "—"}
          </td>
        </tr>
      `;
    }).join("");

    container.innerHTML = `
      <div style="border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h1 style="font-size: 19px; font-weight: 800; color: #0f172a; margin: 0 0 3px 0; letter-spacing: -0.02em;">
              ВЕДОМОСТЬ СМЕНЫ И КАССОВЫЙ ОТЧЁТ
            </h1>
            <p style="font-size: 11px; color: #64748b; margin: 0;">
              SmartRoute Logistics · Официальный документ закрытия рейса
            </p>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 14px; font-weight: 800; color: #0284c7;">
              ${assignment.vehicle_name || "Рейс доставки"}
            </div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
              Дата рейса: <strong>${reportDate}</strong>
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 20px; margin-top: 10px; font-size: 11.5px; color: #334155; background-color: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
          <div>Водитель: <strong style="color: #0f172a;">${assignment.driver_name || "—"}</strong></div>
          <div>Телефон: <strong style="color: #0f172a;">${assignment.driver_phone || "—"}</strong></div>
          <div>Статус: <strong style="color: ${isShiftClosed ? '#16a34a' : '#d97706'};">${isShiftClosed ? 'СМЕНА ЗАКРЫТА' : 'В ПРОЦЕССЕ'}</strong></div>
          <div>Всего точек: <strong style="color: #0f172a;">${executions.length}</strong></div>
        </div>
      </div>

      <!-- Summary KPI Boxes -->
      <div style="display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 12px; margin-bottom: 16px;">
        <!-- Cash Summary Box -->
        <div style="border: 1px solid #bbf7d0; background-color: #f0fdf4; border-radius: 8px; padding: 10px 12px;">
          <div style="font-size: 11.5px; font-weight: 800; color: #166534; margin-bottom: 6px; border-bottom: 1px solid #bbf7d0; padding-bottom: 4px; display: flex; justify-content: space-between;">
            <span>💵 КАССОВЫЙ БАЛАНС</span>
            <span>Фиксировано: ${totalCollectedFixedSum.toLocaleString("ru-RU")} ₽</span>
          </div>
          <div style="font-size: 10.5px; color: #166534; line-height: 1.55;">
            <div>• <strong>Наличные к сдаче в кассу:</strong> <span style="font-size: 12.5px; font-weight: 800;">${totalCashSum.toLocaleString("ru-RU")} ₽</span> (${cashPaidCount} зак.)${cashUnspecifiedCount > 0 ? ` + <strong>${cashUnspecifiedCount} зак. по накладной</strong>` : ""}</div>
            <div>• <strong>Картой / терминалом:</strong> ${totalCardSum.toLocaleString("ru-RU")} ₽ (${cardPaidCount} зак.)${cardUnspecifiedCount > 0 ? ` + ${cardUnspecifiedCount} по накл.` : ""}</div>
            <div>• <strong>Банковский перевод:</strong> ${totalTransferSum.toLocaleString("ru-RU")} ₽ (${transferPaidCount} зак.)${transferUnspecifiedCount > 0 ? ` + ${transferUnspecifiedCount} по накл.` : ""}</div>
            ${freeOrdersCount > 0 ? `<div>• <strong>Без оплаты (договор):</strong> ${freeOrdersCount} зак.</div>` : ""}
            ${notPaidCount > 0 ? `<div style="color: #b45309;">• <strong>Не оплачено (долг):</strong> ${totalNotPaidSum.toLocaleString("ru-RU")} ₽ (${notPaidCount} зак.)</div>` : ""}
          </div>
        </div>

        <!-- Goods Inventory Summary Box -->
        <div style="border: 1px solid #e2e8f0; background-color: #f8fafc; border-radius: 8px; padding: 10px 12px;">
          <div style="font-size: 11.5px; font-weight: 800; color: #0f172a; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; display: flex; justify-content: space-between;">
            <span>📦 ТОВАРНЫЙ БАЛАНС</span>
            <span>Успешность: ${totalPlanQty > 0 ? Math.round((totalDeliveredQty / totalPlanQty) * 100) : 100}%</span>
          </div>
          <div style="font-size: 10.5px; color: #334155; line-height: 1.55;">
            <div>• <strong>Загружено со склада:</strong> ${totalPlanQty} ед.</div>
            <div>• <strong>Фактически сдано:</strong> <strong style="color: #166534;">${totalDeliveredQty} ед.</strong></div>
            <div>• <strong>Возврат / недовоз:</strong> <strong style="color: ${totalShortfallQty > 0 ? '#b45309' : '#64748b'};">${totalShortfallQty} ед.</strong></div>
            <div>• <strong>Точек обработано:</strong> ${deliveredCount + partialCount + failedCount + rescheduledCount} из ${executions.length}</div>
          </div>
        </div>
      </div>

      <!-- Table of points -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; font-family: inherit;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; font-size: 9.5px; text-transform: uppercase; color: #475569;">
            <th style="padding: 5px 4px; text-align: center; width: 24px;">№</th>
            <th style="padding: 5px 6px; text-align: left; width: 125px;">Магазин / Контрагент</th>
            <th style="padding: 5px 6px; text-align: left; width: 145px;">Адрес</th>
            <th style="padding: 5px 6px; text-align: left;">Товары</th>
            <th style="padding: 5px 6px; text-align: right; width: 75px;">Сумма</th>
            <th style="padding: 5px 6px; text-align: center; width: 75px;">Статус</th>
            <th style="padding: 5px 6px; text-align: left; width: 85px;">Оплата</th>
            <th style="padding: 5px 6px; text-align: left; width: 95px;">Примечание</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      ${
        totalUnspecifiedPaidCount > 0
          ? `<div style="font-size: 9.5px; color: #64748b; background-color: #fffbeb; border: 1px solid #fef3c7; padding: 6px 10px; border-radius: 6px; margin-bottom: 14px;">
              * <strong>Примечание по накладным:</strong> По отмеченным заявкам сумма в системе не была указана заранее. Фактическая сумма сдачи наличных и сверки оплат рассчитывается по бумажным накладным (ТТН / УПД).
            </div>`
          : ""
      }

      <!-- Signatures Section -->
      <div style="margin-top: 18px; padding-top: 12px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; font-size: 10.5px; color: #334155;">
        <div style="width: 46%;">
          <div>Сдал (водитель): ____________________ / ${assignment.driver_name || "________________"}</div>
          <div style="font-size: 8.5px; color: #94a3b8; margin-top: 3px;">Подпись подтверждает сдачу товара и собранных денежных средств</div>
        </div>
        <div style="width: 46%; text-align: right;">
          <div>Принял (кассир/диспетчер): ____________________ / ________________</div>
          <div style="font-size: 8.5px; color: #94a3b8; margin-top: 3px;">
            Наличные средства в сумме <strong>${totalCashSum.toLocaleString("ru-RU")} ₽${cashUnspecifiedCount > 0 ? ` (+ ${cashUnspecifiedCount} по накл.)` : ""}</strong> приняты
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const safeName = (assignment.vehicle_name || assignment.driver_name || "Reys").replace(/[^a-zA-Z0-9а-яА-Я_-]/g, "_");
    const filename = `Vedomost_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;

    const blob = pdf.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = blobUrl;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    setTimeout(() => {
      if (downloadLink.parentNode) downloadLink.parentNode.removeChild(downloadLink);
      URL.revokeObjectURL(blobUrl);
    }, 1500);
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
