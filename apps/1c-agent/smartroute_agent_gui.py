"""
SmartRoute 1C Agent - Graphical User Interface (High-DPI, Crisp Vector Styling)
Modern, step-by-step desktop application for Windows to configure 1C connection,
pair with SmartRoute, and monitor real-time background synchronization.
"""

import sys
import os
import datetime
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading

# Enable Windows High-DPI crisp rendering before initializing any Tkinter widgets
if sys.platform == "win32":
    try:
        import ctypes
        # Try Per-Monitor v2 or System DPI awareness
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2) # Per-monitor v2
        except Exception:
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(1) # System DPI
            except Exception:
                ctypes.windll.user32.SetProcessDPIAware()
        # Set AppUserModelID so Windows taskbar shows the correct icon
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("SmartRoute.1CAgent.App.v3")
    except Exception:
        pass

from config_manager import ConfigManager, get_log_path
from onec_connector import OneCConnector
from smartroute_client import SmartRouteAPIClient
from sync_engine import SyncEngine


class SmartRouteAgentGUI:
    """Main GUI Application for SmartRoute 1C Agent with 3-step Wizard layout."""

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("SmartRoute — Агент интеграции 1С:Предприятие")
        self.root.geometry("860x680")
        self.root.minsize(780, 600)

        # Set Window Icon
        self._setup_icon()

        # Initialize core components
        self.config = ConfigManager()
        self.onec = OneCConnector()
        self.client = SmartRouteAPIClient(
            base_url=self.config.server_url,
            api_token=self.config.api_token,
        )
        self.client.agent_id = self.config.data.get("agent_id", "")
        self.sync_engine = SyncEngine(self.config, self.onec, self.client)

        # Wire up engine callbacks
        self.sync_engine.on_log_message = self._append_log_threadsafe
        self.sync_engine.on_sync_started = self._on_sync_started
        self.sync_engine.on_sync_finished = self._on_sync_finished

        # Apply modern Windows visual styling
        self._setup_styles()

        # Build UI layout
        self._build_ui()

        # Populate current config data
        self._load_config_to_ui()

        # Start sync engine if already paired
        if self.config.is_paired:
            self.sync_engine.start()

    def _setup_icon(self):
        """Loads and sets the window icon."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        icon_path = os.path.join(script_dir, "smartroute.ico")
        if os.path.exists(icon_path):
            try:
                self.root.iconbitmap(icon_path)
            except Exception:
                pass

    def _setup_styles(self):
        """Configures ttk styles for clean, crisp appearance."""
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass

        # Color Palette
        self.bg_main = "#f1f5f9"
        self.bg_card = "#ffffff"
        self.primary = "#0284c7"
        self.primary_hover = "#0369a1"
        self.primary_light = "#e0f2fe"
        self.text_dark = "#0f172a"
        self.text_muted = "#64748b"
        self.border = "#cbd5e1"
        self.success = "#16a34a"
        self.success_bg = "#f0fdf4"
        self.warning = "#d97706"
        self.warning_bg = "#fffbeb"
        self.danger = "#dc2626"
        self.danger_bg = "#fef2f2"

        self.root.configure(bg=self.bg_main)

        # Typography
        style.configure(".", background=self.bg_main, foreground=self.text_dark, font=("Segoe UI", 10))
        style.configure("TNotebook", background=self.bg_main, borderwidth=0)
        style.configure(
            "TNotebook.Tab",
            padding=[18, 10],
            font=("Segoe UI", 10, "bold"),
            background="#e2e8f0",
            foreground="#475569",
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", "#ffffff")],
            foreground=[("selected", self.primary)],
        )

        style.configure("Card.TFrame", background=self.bg_card, relief="flat")
        style.configure("Primary.TButton", font=("Segoe UI", 10, "bold"), background=self.primary, foreground="#ffffff", padding=[14, 8])
        style.map("Primary.TButton", background=[("active", self.primary_hover)])

    def _build_ui(self):
        # 1. Header Bar
        header = tk.Frame(self.root, bg="#0f172a", height=68)
        header.pack(fill=tk.X, side=tk.TOP)
        header.pack_propagate(False)

        # Header Title & Logo
        title_box = tk.Frame(header, bg="#0f172a")
        title_box.pack(side=tk.LEFT, padx=20, pady=12)

        title_lbl = tk.Label(
            title_box,
            text="⚡️ SmartRoute 1C Agent",
            bg="#0f172a",
            fg="#ffffff",
            font=("Segoe UI", 13, "bold"),
        )
        title_lbl.pack(anchor="w")

        sub_title_lbl = tk.Label(
            title_box,
            text="Интеграция 1С:Предприятие 8.3 / 8.2 с маршрутизацией SmartRoute",
            bg="#0f172a",
            fg="#94a3b8",
            font=("Segoe UI", 9),
        )
        sub_title_lbl.pack(anchor="w")

        # Header Status Badge
        self.status_badge = tk.Label(
            header,
            text="● Не привязано",
            bg="#334155",
            fg="#cbd5e1",
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=6,
        )
        self.status_badge.pack(side=tk.RIGHT, padx=20)

        # 2. Main Step-by-Step Notebook Tabs
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=16, pady=16)

        # Tab 1: Pairing (Шаг 1)
        self.tab_pairing = ttk.Frame(self.notebook, style="Card.TFrame")
        # Tab 2: 1C Connection (Шаг 2)
        self.tab_onec = ttk.Frame(self.notebook, style="Card.TFrame")
        # Tab 3: Dashboard & Sync (Шаг 3)
        self.tab_dashboard = ttk.Frame(self.notebook, style="Card.TFrame")
        # Tab 4: Logs
        self.tab_logs = ttk.Frame(self.notebook, style="Card.TFrame")

        self.notebook.add(self.tab_pairing, text=" 1️⃣ Шаг 1: Привязка к SmartRoute ")
        self.notebook.add(self.tab_onec, text=" 2️⃣ Шаг 2: Подключение к 1С ")
        self.notebook.add(self.tab_dashboard, text=" 3️⃣ Шаг 3: Синхронизация ")
        self.notebook.add(self.tab_logs, text=" 📋 Журнал событий ")

        self._build_pairing_tab()
        self._build_onec_tab()
        self._build_dashboard_tab()
        self._build_logs_tab()

    # =========================================================================
    # TAB 1: PAIRING WIZARD (ШАГ 1)
    # =========================================================================
    def _build_pairing_tab(self):
        parent = self.tab_pairing
        container = tk.Frame(parent, bg=self.bg_card, padx=28, pady=24)
        container.pack(fill=tk.BOTH, expand=True)

        # Step Header Card
        hdr_frame = tk.Frame(container, bg=self.primary_light, padx=16, pady=12, highlightbackground="#bae6fd", highlightthickness=1)
        hdr_frame.pack(fill=tk.X, pady=(0, 20))

        tk.Label(
            hdr_frame,
            text="ШАГ 1: Привязка программы к вашему личному кабинету SmartRoute",
            bg=self.primary_light,
            fg="#0369a1",
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w")

        tk.Label(
            hdr_frame,
            text="В личном кабинете SmartRoute в разделе «Интеграции» нажмите «Сгенерировать код привязки» и вставьте его ниже.",
            bg=self.primary_light,
            fg="#0c4a6e",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(2, 0))

        # Server URL
        tk.Label(container, text="Адрес сервера SmartRoute (API):", bg=self.bg_card, font=("Segoe UI", 9, "bold"), fg=self.text_dark).pack(anchor="w")
        self.entry_server_url = ttk.Entry(container, font=("Segoe UI", 10))
        self.entry_server_url.pack(anchor="w", pady=(4, 16), fill=tk.X)

        # Pairing Code Input
        tk.Label(container, text="Код привязки (например SMARTROUTE-7824-9132):", bg=self.bg_card, font=("Segoe UI", 10, "bold"), fg=self.text_dark).pack(anchor="w")
        self.entry_pairing_code = ttk.Entry(container, font=("Segoe UI", 13, "bold"), justify="center")
        self.entry_pairing_code.pack(anchor="w", pady=(6, 16), fill=tk.X)

        # Pair Button & Next Step Row
        act_row = tk.Frame(container, bg=self.bg_card)
        act_row.pack(fill=tk.X, pady=8)

        self.btn_pair = tk.Button(
            act_row,
            text=" 🔗 Привязать к SmartRoute ",
            bg=self.primary,
            fg="#ffffff",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=20,
            pady=10,
            cursor="hand2",
            command=self._on_pair_with_code,
        )
        self.btn_pair.pack(side=tk.LEFT)

        self.btn_goto_step2 = tk.Button(
            act_row,
            text="Перейти к Шагу 2 (Подключение 1С) ➔",
            bg="#f1f5f9",
            fg=self.primary,
            font=("Segoe UI", 10, "bold"),
            relief="groove",
            padx=16,
            pady=9,
            command=lambda: self.notebook.select(self.tab_onec),
        )
        self.btn_goto_step2.pack(side=tk.RIGHT)

        # Result Banner
        self.pairing_result_box = tk.Frame(container, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        self.pairing_result_box.pack(fill=tk.X, pady=16)

        self.pairing_result_lbl = tk.Label(
            self.pairing_result_box,
            text="ℹ️ Введите код привязки и нажмите кнопку «Привязать к SmartRoute».",
            bg="#f8fafc",
            fg=self.text_muted,
            font=("Segoe UI", 9),
            justify="left",
            wraplength=720,
        )
        self.pairing_result_lbl.pack(anchor="w")

    # =========================================================================
    # TAB 2: 1C CONNECTION WIZARD (ШАГ 2)
    # =========================================================================
    def _build_onec_tab(self):
        parent = self.tab_onec
        container = tk.Frame(parent, bg=self.bg_card, padx=28, pady=24)
        container.pack(fill=tk.BOTH, expand=True)

        # Step Header Card
        hdr_frame = tk.Frame(container, bg="#f0fdf4", padx=16, pady=12, highlightbackground="#bbf7d0", highlightthickness=1)
        hdr_frame.pack(fill=tk.X, pady=(0, 16))

        tk.Label(
            hdr_frame,
            text="ШАГ 2: Подключение к вашей базе 1С:Предприятие",
            bg="#f0fdf4",
            fg="#166534",
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w")

        tk.Label(
            hdr_frame,
            text="Агент подключается напрямую к вашей базе через 1С COMConnector. Выберите базу и укажите пользователя 1С.",
            bg="#f0fdf4",
            fg="#14532d",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(2, 0))

        # Base Selection Dropdown
        tk.Label(container, text="Выберите базу 1С (найдено в списке баз 1С на этом ПК):", bg=self.bg_card, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.cb_bases = ttk.Combobox(container, state="readonly", font=("Segoe UI", 10))
        self.cb_bases.pack(anchor="w", pady=(4, 10), fill=tk.X)
        self.cb_bases.bind("<<ComboboxSelected>>", self._on_select_base)

        # Connection String Entry
        tk.Label(container, text="Строка подключения к базе 1С (File=... или Srvr=...;Ref=...):", bg=self.bg_card, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_conn_str = ttk.Entry(container, font=("Segoe UI", 9))
        self.entry_conn_str.pack(anchor="w", pady=(4, 12), fill=tk.X)

        # User Credentials
        cred_frame = tk.Frame(container, bg=self.bg_card)
        cred_frame.pack(fill=tk.X, pady=4)

        u_col = tk.Frame(cred_frame, bg=self.bg_card)
        u_col.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 12))
        tk.Label(u_col, text="Имя пользователя 1С (Логин):", bg=self.bg_card, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_onec_user = ttk.Entry(u_col, font=("Segoe UI", 10))
        self.entry_onec_user.pack(anchor="w", pady=(4, 0), fill=tk.X)

        p_col = tk.Frame(cred_frame, bg=self.bg_card)
        p_col.pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Label(p_col, text="Пароль пользователя 1С (если есть):", bg=self.bg_card, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        self.entry_onec_pwd = ttk.Entry(p_col, show="*", font=("Segoe UI", 10))
        self.entry_onec_pwd.pack(anchor="w", pady=(4, 0), fill=tk.X)

        # Actions Row
        act_frame = tk.Frame(container, bg=self.bg_card)
        act_frame.pack(fill=tk.X, pady=16)

        self.btn_test_onec = tk.Button(
            act_frame,
            text=" 🔌 Проверить и сохранить подключение 1С ",
            bg=self.primary,
            fg="#ffffff",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=16,
            pady=8,
            cursor="hand2",
            command=self._on_test_and_save_onec,
        )
        self.btn_test_onec.pack(side=tk.LEFT)

        self.btn_goto_step3 = tk.Button(
            act_frame,
            text="Перейти к Шагу 3 (Синхронизация) ➔",
            bg="#f1f5f9",
            fg=self.primary,
            font=("Segoe UI", 10, "bold"),
            relief="groove",
            padx=16,
            pady=8,
            command=lambda: self.notebook.select(self.tab_dashboard),
        )
        self.btn_goto_step3.pack(side=tk.RIGHT)

        # Result box
        self.onec_result_box = tk.Frame(container, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        self.onec_result_box.pack(fill=tk.X, pady=4)

        self.onec_result_lbl = tk.Label(
            self.onec_result_box,
            text="ℹ️ Нажмите «Проверить и сохранить подключение 1С» для тестирования связи.",
            bg="#f8fafc",
            fg=self.text_muted,
            font=("Segoe UI", 9),
            justify="left",
            wraplength=720,
        )
        self.onec_result_lbl.pack(anchor="w")

    # =========================================================================
    # TAB 3: DASHBOARD & SYNC (ШАГ 3)
    # =========================================================================
    def _build_dashboard_tab(self):
        parent = self.tab_dashboard
        container = tk.Frame(parent, bg=self.bg_card, padx=28, pady=24)
        container.pack(fill=tk.BOTH, expand=True)

        # Top Status Section
        st_frame = tk.Frame(container, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        st_frame.pack(fill=tk.X, pady=(0, 16))

        self.dash_status_lbl = tk.Label(
            st_frame,
            text="Статус: Ожидает настройки",
            bg="#f8fafc",
            fg=self.text_dark,
            font=("Segoe UI", 11, "bold"),
        )
        self.dash_status_lbl.pack(anchor="w")

        self.dash_base_lbl = tk.Label(
            st_frame,
            text="База 1С: Не настроена",
            bg="#f8fafc",
            fg=self.text_muted,
            font=("Segoe UI", 9),
        )
        self.dash_base_lbl.pack(anchor="w", pady=(2, 0))

        # Metrics 3-Cards Row
        metrics_frame = tk.Frame(container, bg=self.bg_card)
        metrics_frame.pack(fill=tk.X, pady=8)

        # Card 1: Orders Sent
        c1 = tk.Frame(metrics_frame, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        c1.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 8))
        tk.Label(c1, text="Передано в SmartRoute", bg="#f8fafc", fg=self.text_muted, font=("Segoe UI", 9)).pack(anchor="w")
        self.lbl_sent_count = tk.Label(c1, text="0", bg="#f8fafc", fg=self.primary, font=("Segoe UI", 20, "bold"))
        self.lbl_sent_count.pack(anchor="w", pady=(4, 0))

        # Card 2: Statuses Updated
        c2 = tk.Frame(metrics_frame, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        c2.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=4)
        tk.Label(c2, text="Обновлено статусов в 1С", bg="#f8fafc", fg=self.text_muted, font=("Segoe UI", 9)).pack(anchor="w")
        self.lbl_received_count = tk.Label(c2, text="0", bg="#f8fafc", fg=self.success, font=("Segoe UI", 20, "bold"))
        self.lbl_received_count.pack(anchor="w", pady=(4, 0))

        # Card 3: Last Sync
        c3 = tk.Frame(metrics_frame, bg="#f8fafc", padx=16, pady=12, highlightbackground=self.border, highlightthickness=1)
        c3.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(8, 0))
        tk.Label(c3, text="Последняя синхронизация", bg="#f8fafc", fg=self.text_muted, font=("Segoe UI", 9)).pack(anchor="w")
        self.lbl_last_sync = tk.Label(c3, text="—", bg="#f8fafc", fg=self.text_dark, font=("Segoe UI", 14, "bold"))
        self.lbl_last_sync.pack(anchor="w", pady=(8, 0))

        # Sync Settings Controls
        ctrl_frame = tk.LabelFrame(container, text="Настройки автоматической синхронизации", bg=self.bg_card, padx=16, pady=12, font=("Segoe UI", 10, "bold"))
        ctrl_frame.pack(fill=tk.X, pady=16)

        # Row 1: Interval & Period
        r1 = tk.Frame(ctrl_frame, bg=self.bg_card)
        r1.pack(fill=tk.X, pady=4)

        tk.Label(r1, text="Интервал фонового опроса:", bg=self.bg_card).pack(side=tk.LEFT)
        self.cb_interval = ttk.Combobox(r1, values=["1 минута", "5 минут", "15 минут", "30 минут", "60 минут"], state="readonly", width=14)
        self.cb_interval.set("5 минут")
        self.cb_interval.pack(side=tk.LEFT, padx=(8, 24))
        self.cb_interval.bind("<<ComboboxSelected>>", self._on_interval_changed)

        tk.Label(r1, text="Период выборки заказов:", bg=self.bg_card).pack(side=tk.LEFT)
        self.cb_period = ttk.Combobox(r1, values=["За последние 2 часа", "За последние 24 часа", "За сегодня", "За последние 3 дня"], state="readonly", width=22)
        self.cb_period.set("За последние 24 часа")
        self.cb_period.pack(side=tk.LEFT, padx=8)
        self.cb_period.bind("<<ComboboxSelected>>", self._on_period_changed)

        # Action Buttons
        btn_bar = tk.Frame(container, bg=self.bg_card)
        btn_bar.pack(fill=tk.X, pady=12)

        self.btn_sync_now = tk.Button(
            btn_bar,
            text=" 🔄 Синхронизировать сейчас ",
            bg=self.primary,
            fg="#ffffff",
            font=("Segoe UI", 10, "bold"),
            relief="flat",
            padx=18,
            pady=10,
            cursor="hand2",
            command=self._on_click_sync_now,
        )
        self.btn_sync_now.pack(side=tk.LEFT)

        self.btn_disconnect = tk.Button(
            btn_bar,
            text="Отвязать 1С от SmartRoute",
            bg="#ffffff",
            fg=self.danger,
            font=("Segoe UI", 9),
            relief="groove",
            padx=12,
            pady=8,
            command=self._on_click_disconnect,
        )
        self.btn_disconnect.pack(side=tk.RIGHT)

    # =========================================================================
    # TAB 4: LOGS
    # =========================================================================
    def _build_logs_tab(self):
        parent = self.tab_logs
        container = tk.Frame(parent, bg=self.bg_card, padx=16, pady=12)
        container.pack(fill=tk.BOTH, expand=True)

        # Log Text Box
        self.txt_logs = scrolledtext.ScrolledText(
            container,
            wrap=tk.WORD,
            bg="#0f172a",
            fg="#f8fafc",
            insertbackground="#ffffff",
            font=("Consolas", 10),
            padx=10,
            pady=10,
        )
        self.txt_logs.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        # Color tags
        self.txt_logs.tag_config("SUCCESS", foreground="#4ade80")
        self.txt_logs.tag_config("ERROR", foreground="#f87171")
        self.txt_logs.tag_config("WARNING", foreground="#fbbf24")
        self.txt_logs.tag_config("INFO", foreground="#93c5fd")

        # Bottom Bar
        bar = tk.Frame(container, bg=self.bg_card)
        bar.pack(fill=tk.X)

        tk.Button(bar, text="Очистить журнал", bg="#ffffff", fg=self.text_dark, relief="groove", padx=12, pady=4, command=self._clear_logs).pack(side=tk.LEFT)
        tk.Button(bar, text="Открыть файл лога", bg="#ffffff", fg=self.text_dark, relief="groove", padx=12, pady=4, command=self._open_log_file).pack(side=tk.LEFT, padx=8)

    # =========================================================================
    # LOGIC & HANDLERS
    # =========================================================================
    def _load_config_to_ui(self):
        """Populates UI entries from config manager."""
        # 1C Bases
        bases = self.onec.get_registered_ibases()
        self.detected_bases = bases
        names = [b.get("name", "База 1С") for b in bases]
        self.cb_bases["values"] = names

        saved_base_name = self.config.data["onec"].get("base_name", "")
        if saved_base_name in names:
            self.cb_bases.set(saved_base_name)
        elif names:
            self.cb_bases.set(names[0])
            self._on_select_base(None)

        if self.config.data["onec"].get("connection_string"):
            self.entry_conn_str.delete(0, tk.END)
            self.entry_conn_str.insert(0, self.config.data["onec"]["connection_string"])

        self.entry_onec_user.delete(0, tk.END)
        self.entry_onec_user.insert(0, self.config.data["onec"].get("username", ""))

        self.entry_onec_pwd.delete(0, tk.END)
        self.entry_onec_pwd.insert(0, self.config.onec_password)

        self.entry_server_url.delete(0, tk.END)
        self.entry_server_url.insert(0, self.config.server_url)

        self._refresh_status_view()

    def _refresh_status_view(self):
        """Updates dashboard counters, status badges and indicators."""
        is_p = self.config.is_paired
        last_sync = self.config.data["stats"].get("last_sync_time")
        sent = self.config.data["stats"].get("total_orders_sent", 0)
        rec = self.config.data["stats"].get("total_statuses_received", 0)
        base_name = self.config.data["onec"].get("base_name", "1С:Предприятие")

        self.lbl_sent_count.config(text=str(sent))
        self.lbl_received_count.config(text=str(rec))

        if last_sync:
            try:
                dt = datetime.datetime.fromisoformat(last_sync)
                self.lbl_last_sync.config(text=dt.strftime("%d.%m %H:%M"))
            except Exception:
                self.lbl_last_sync.config(text=str(last_sync)[:16])
        else:
            self.lbl_last_sync.config(text="—")

        if is_p:
            org = self.config.data.get("organization", "SmartRoute")
            self.status_badge.config(text=f"● Привязано ({org})", bg="#15803d", fg="#ffffff")
            self.dash_status_lbl.config(text="Статус: 🟢 Подключено к SmartRoute (Автосинхронизация активна)", fg=self.success)
            self.dash_base_lbl.config(text=f"База 1С: {base_name} ({self.config.data['onec'].get('v8_version', '8.3')})")
            self.pairing_result_box.config(bg=self.success_bg, highlightbackground="#86efac")
            self.pairing_result_lbl.config(
                text=f"✅ Программа успешно привязана к организации «{org}»!\nТокен сохранён. Вы можете перейти ко 2-му шагу для подключения 1С.",
                bg=self.success_bg,
                fg=self.success,
            )
        else:
            self.status_badge.config(text="● Не привязано", bg="#334155", fg="#cbd5e1")
            self.dash_status_lbl.config(text="Статус: 🟡 Ожидает привязки к SmartRoute (Шаг 1)", fg=self.warning)
            self.dash_base_lbl.config(text="Перейдите на вкладку 'Шаг 1: Привязка к SmartRoute'")

    def _on_select_base(self, event):
        selected_name = self.cb_bases.get()
        for b in self.detected_bases:
            if b.get("name") == selected_name:
                conn = b.get("connect", "")
                self.entry_conn_str.delete(0, tk.END)
                self.entry_conn_str.insert(0, conn)
                break

    def _on_pair_with_code(self):
        url = self.entry_server_url.get().strip()
        code = self.entry_pairing_code.get().strip()

        if not url:
            messagebox.showwarning("SmartRoute", "Укажите адрес сервера SmartRoute!")
            return
        if not code:
            messagebox.showwarning("SmartRoute", "Введите код привязки из личного кабинета SmartRoute!")
            return

        self.btn_pair.config(state=tk.DISABLED, text="Привязка...")
        self.pairing_result_box.config(bg="#f8fafc", highlightbackground=self.border)
        self.pairing_result_lbl.config(text="⏳ Отправка запроса на сервер SmartRoute...", bg="#f8fafc", fg=self.text_dark)

        self.config.server_url = url
        self.client.base_url = url

        base_name = self.cb_bases.get() or self.config.data["onec"].get("base_name") or "1C Infobase"
        config_type = self.onec.base_info.get("config_name", "1С:Предприятие 8.3")

        def worker():
            ok, msg, resp = self.client.pair(
                pairing_code=code,
                base_name=base_name,
                config_type=config_type,
                v8_version=self.config.data["onec"].get("v8_version", "8.3"),
            )
            self.root.after(0, lambda: self._handle_pair_result(ok, msg, resp))

        threading.Thread(target=worker, daemon=True).start()

    def _handle_pair_result(self, ok: bool, msg: str, resp: dict):
        self.btn_pair.config(state=tk.NORMAL, text=" 🔗 Привязать к SmartRoute ")
        if ok:
            self.config.api_token = resp.get("token", "")
            self.config.data["agent_id"] = resp.get("agent_id", "")
            self.config.data["organization"] = resp.get("organization", "SmartRoute")
            self.config.save()

            self.client.api_token = self.config.api_token
            self.client.agent_id = self.config.data["agent_id"]

            self._refresh_status_view()

            # Start sync engine
            self.sync_engine.start()

            messagebox.showinfo("SmartRoute", "Успешно! 1С привязана к SmartRoute.\nТеперь перейдите к Шагу 2 для проверки базы 1С.")
            self.notebook.select(self.tab_onec)
        else:
            self.pairing_result_box.config(bg=self.danger_bg, highlightbackground="#fca5a5")
            self.pairing_result_lbl.config(
                text=f"❌ Ошибка привязки: {msg}\nПроверьте правильность кода привязки и адреса сервера SmartRoute.",
                bg=self.danger_bg,
                fg=self.danger,
            )
            messagebox.showerror("Ошибка привязки", f"{msg}\n\nУбедитесь, что код не просрочен и адрес сервера указан верно.")

    def _on_test_and_save_onec(self):
        base_name = self.cb_bases.get() or "1С:Предприятие"
        conn_str = self.entry_conn_str.get().strip()
        user = self.entry_onec_user.get().strip()
        pwd = self.entry_onec_pwd.get()

        if not conn_str:
            messagebox.showwarning("1С", "Укажите строку подключения к 1С!")
            return

        self.btn_test_onec.config(state=tk.DISABLED, text="Проверка соединения 1С...")
        self.onec_result_box.config(bg="#f8fafc", highlightbackground=self.border)
        self.onec_result_lbl.config(text="⏳ Подключение к 1С через COMConnector...", bg="#f8fafc", fg=self.text_dark)

        # Save settings first
        self.config.data["onec"]["base_name"] = base_name
        self.config.data["onec"]["connection_string"] = conn_str
        self.config.data["onec"]["username"] = user
        self.config.onec_password = pwd
        self.config.save()

        def worker():
            ok, msg, meta = self.onec.connect(conn_str, user, pwd)
            self.root.after(0, lambda: self._handle_onec_test_result(ok, msg, meta))

        threading.Thread(target=worker, daemon=True).start()

    def _handle_onec_test_result(self, ok: bool, msg: str, meta: dict):
        self.btn_test_onec.config(state=tk.NORMAL, text=" 🔌 Проверить и сохранить подключение 1С ")
        if ok:
            self.onec_result_box.config(bg=self.success_bg, highlightbackground="#86efac")
            self.onec_result_lbl.config(
                text=f"✅ УСПЕШНО!\n{msg}\nКонфигурация: {meta.get('config_name')} (v{meta.get('config_version')})\nПлатформа: {meta.get('platform_version')}",
                bg=self.success_bg,
                fg=self.success,
            )
            # Update config
            self.config.data["onec"]["v8_version"] = meta.get("platform_version", "8.3")
            self.config.save()
            self._refresh_status_view()
            messagebox.showinfo("1С:Предприятие", "Соединение с 1С успешно установлено и сохранено!\nПерейдите к Шагу 3 для запуска синхронизации.")
            self.notebook.select(self.tab_dashboard)
        else:
            self.onec_result_box.config(bg=self.danger_bg, highlightbackground="#fca5a5")
            self.onec_result_lbl.config(
                text=f"❌ ОШИБКА ПОДКЛЮЧЕНИЯ К 1С:\n{msg}\nПроверьте правильность логина и пароля пользователя 1С.",
                bg=self.danger_bg,
                fg=self.danger,
            )

    def _on_click_sync_now(self):
        if not self.config.is_paired:
            messagebox.showwarning("SmartRoute", "Сначала выполните привязку на вкладке «Шаг 1»!")
            self.notebook.select(self.tab_pairing)
            return

        self.btn_sync_now.config(state=tk.DISABLED, text="Синхронизация...")
        self.sync_engine.run_sync_now()

    def _on_click_disconnect(self):
        if messagebox.askyesno("Подтверждение", "Вы уверены, что хотите отвязать эту базу 1С от SmartRoute?"):
            self.sync_engine.stop()
            self.config.clear_pairing()
            self.client.api_token = ""
            self._refresh_status_view()
            messagebox.showinfo("SmartRoute", "База 1С отвязана от SmartRoute.")
            self.notebook.select(self.tab_pairing)

    def _on_interval_changed(self, event):
        val = self.cb_interval.get()
        mins = int(val.split()[0])
        self.config.data["sync"]["interval_minutes"] = mins
        self.config.save()

    def _on_period_changed(self, event):
        val = self.cb_period.get()
        hours = 24
        if "2 часа" in val:
            hours = 2
        elif "24 часа" in val:
            hours = 24
        elif "сегодня" in val:
            hours = 12
        elif "3 дня" in val:
            hours = 72
        self.config.data["sync"]["sync_period_hours"] = hours
        self.config.save()

    def _on_sync_started(self):
        self.root.after(0, lambda: self.btn_sync_now.config(state=tk.DISABLED, text="Синхронизация..."))

    def _on_sync_finished(self, summary: dict):
        self.root.after(0, lambda: self._update_ui_after_sync(summary))

    def _update_ui_after_sync(self, summary: dict):
        self.btn_sync_now.config(state=tk.NORMAL, text=" 🔄 Синхронизировать сейчас ")
        self._refresh_status_view()

    def _append_log_threadsafe(self, level: str, message: str):
        self.root.after(0, lambda: self._append_log_ui(level, message))

    def _append_log_ui(self, level: str, message: str):
        now_str = datetime.datetime.now().strftime("%H:%M:%S")
        line = f"[{now_str}] [{level.upper()}] {message}\n"
        self.txt_logs.insert(tk.END, line, level.upper())
        self.txt_logs.see(tk.END)

    def _clear_logs(self):
        self.txt_logs.delete("1.0", tk.END)

    def _open_log_file(self):
        lp = get_log_path()
        if os.path.exists(lp):
            if sys.platform == "win32":
                os.startfile(lp)
            else:
                messagebox.showinfo("Лог", f"Путь к логу:\n{lp}")
        else:
            messagebox.showinfo("Лог", "Файл лога еще не создан.")


def main():
    root = tk.Tk()
    app = SmartRouteAgentGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
