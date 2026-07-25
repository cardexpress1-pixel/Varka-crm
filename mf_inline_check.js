, и если cdnjs медленно
     отвечает/недоступен (сторонний CDN, флаки сети, блокировщики), парсер HTML
     стоит на этой строке и ни один inline-скрипт ниже (включая init-код, который
     скрывает "Подключение...") вообще не запускается. XLSX нужен только внутри
     функций экспорта в Excel (по клику), не при загрузке страницы — defer безопасен. -->
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" integrity="sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==" crossorigin="anonymous">
;

// Синхронно, ДО первой отрисовки: применяем класс темы сразу, не дожидаясь
// конца async init-IIFE (после сетевых запросов). Раньше body получал
// theme-light только в самом конце загрузки — всё время до этого страница
// красилась в тёмные цвета :root по умолчанию (см. комментарий у
// loading-screen ниже), что и выглядело как чёрный экран на каждом заходе.
(function () {
  try {
    var cached = JSON.parse(localStorage.getItem('varka_state_v2') || '{}');
    var isDark = cached.themeUserSet && cached.theme === 'dark';
    if (!isDark) document.body.classList.add('theme-light');
  } catch (e) {
    document.body.classList.add('theme-light'); // безопасный дефолт при любой ошибке
  }
})();

;

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════
let state = {
  clients: [],
  recipes: [],
  reactors: ['Р-1','Р-2','Р-3','Р-4'],
  pouringLines: ['Линия 1','Линия 2','Ручной розлив'],
  requests: [],
  batches: [],
  batchCounter: 1,
  requestCounter: 1,
  workdayHours: 8,
  // ── Динамические роли (конструктор) ──
  // Каждая роль: { id, name, login, password, tabs:[...], fields:{...} }
  // tabs — массив id вкладок навигации, доступных этой роли
  // fields — объект видимости отдельных полей (используется на странице "Участок варки")
  roles: [],
  sheetsUrl: '', // legacy field, мигрируется в integrations.googleSheets
  integrations: {
    googleSheets: '',
    telegram: '',
    email: ''
  },
  filterStatus: 'all',
  filterReactor: 'all',
  filterPouringLine: 'all',
  filterRequestStatus: 'all',
  currentBatchId: null,
  calMonth: new Date().getMonth(),
  calYear: new Date().getFullYear(),
  calSelectedDate: null,
  // ── Недельный план (расчётный, не создаёт варки) ──
  stockLevels: {},        // { sku: остаток_шт }
  wpClients: [],           // подмножество state.clients, видимое в таблице плана
  wpWeekStart: null,        // ISO дата понедельника текущей выбранной недели
  wpDemand: {},             // { "weekStartIso": { sku: { client: qty } } }
  wpBrewPlan: {},           // { "weekStartIso": { sku: { dateIso: qty } } }
  wpGenerated: {},          // { "weekStartIso": { sku: { dateIso: batchId } } } — что уже превращено в варку
  wpHistoryCollapsed: true,  // история по неделям свёрнута по умолчанию
  navTabsOrder: [],   // кастомный порядок пунктов бокового меню (id вкладок); пусто = порядок по умолчанию (ALL_TABS)
  navTabsLabels: {},  // кастомные названия пунктов бокового меню { id: 'новое название' }; пусто = название по умолчанию
  // pmStage НЕ хранится в state/Firestore — это локальный UI-выбор (см. _pmStage + sessionStorage)
  pmDate: null,        // выбранная дата в «Управлении производством»
  pmShowAll: true,      // показывать все даты (без фильтра) в «Управлении производством»
  journalActiveTab: 'events', // активная вкладка операционного журнала
  journalEntries: [],   // лента ручных действий операторов: { id, timestamp, roleName, batchId, batchName, text, source, page, pmStage }
  systemEvents: [],    // системные события (алармы, автостатусы): { id, timestamp, severity, batchId, batchName, text, source, page, pmStage }
  loggedAlarmKeys: {}, // { alarmKey: ISO-timestamp } — алармы уже попавшие в журнал событий (без дублей)
  theme: 'light',        // 'dark' | 'light' — общая настройка на устройстве, не привязана к роли. Светлая по умолчанию (стандарт дизайна)
  themeUserSet: false    // true только если пользователь ЯВНО переключал тему вручную (toggleTheme); иначе тема принудительно светлая
};

let currentUser = null; // { roleId: string }

// SVG-иконки для навигации (industrial SaaS style)
const NAV_ICONS = {
  dashboard:  `<svg class="ni ni-dashboard" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
  production: `<svg class="ni ni-production" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line class="ni-handle" x1="1" y1="14" x2="7" y2="14"/><line class="ni-handle" x1="9" y1="8" x2="15" y2="8"/><line class="ni-handle" x1="17" y1="16" x2="23" y2="16"/></svg>`,
  weekplan:   `<svg class="ni ni-weekplan" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/><rect class="ni-wpc1" x="4.5" y="4.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc2" x="10.5" y="4.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc3" x="16.5" y="4.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc4" x="4.5" y="10.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc5" x="10.5" y="10.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc6" x="16.5" y="10.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc7" x="4.5" y="16.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc8" x="10.5" y="16.5" width="3" height="3" rx="0.5" stroke="none"/><rect class="ni-wpc9" x="16.5" y="16.5" width="3" height="3" rx="0.5" stroke="none"/></svg>`,
  calendar:   `<svg class="ni ni-calendar" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><defs><clipPath id="ni-calclip"><rect x="3.5" y="9.4" width="17" height="12.6" rx="1.5"/></clipPath></defs><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="9" x2="21" y2="9"/><g clip-path="url(#ni-calclip)"><rect class="ni-cal-next" x="5.5" y="11" width="13" height="9" rx="1" fill="var(--accent)" stroke="none" opacity="0.3"/><rect class="calendar-sheet" x="5.5" y="11" width="13" height="9" rx="1" fill="var(--accent)" stroke="none"/></g></svg>`,
  warshchik:  `<svg class="ni ni-warshchik" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="13" x2="20" y2="13"/><path d="M5 13v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/><circle class="ni-wb1" cx="9" cy="10" r="1.5"/><circle class="ni-wb2" cx="15" cy="8" r="1.2"/><circle class="ni-wb3" cx="12" cy="5" r="1"/></svg>`,
  intake:     `<svg class="ni ni-intake" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  reports:    `<svg class="ni ni-reports" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  journal:    `<svg class="ni ni-journal" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  admin:      `<svg class="ni ni-admin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

// Список всех вкладок, доступных для назначения ролям, с их id и подписями
const ALL_TABS = [
  ['dashboard','Дашборд', NAV_ICONS.dashboard],
  ['production','Управление производством', NAV_ICONS.production],
  ['weekplan','Недельный план', NAV_ICONS.weekplan],
  ['calendar','Календарь производства', NAV_ICONS.calendar],
  ['warshchik','Участок варки', NAV_ICONS.warshchik],
  ['intake','Участок розлива', NAV_ICONS.intake],
  ['reports','Отчёты', NAV_ICONS.reports],
  ['journal','Операционный журнал', NAV_ICONS.journal],
  ['admin','Админ-панель', NAV_ICONS.admin],
];

// Возвращает вкладки в порядке и с названиями, заданными админом (state.navTabsOrder /
// state.navTabsLabels), с подстановкой значений по умолчанию из ALL_TABS, где админ
// ничего не менял. id вкладки (технический идентификатор) никогда не меняется —
// меняется только то, что видит пользователь (название, порядок).
function getEffectiveTabs() {
  const defaultOrder = ALL_TABS.map(t => t[0]);
  const customOrder = (state.navTabsOrder && state.navTabsOrder.length) ? state.navTabsOrder : defaultOrder;
  // на случай если в ALL_TABS появилась новая вкладка после того, как админ уже
  // сохранил свой порядок — дописываем отсутствующие id в конец, в исходном порядке
  const known = new Set(customOrder);
  const missing = defaultOrder.filter(id => !known.has(id));
  const fullOrder = [...customOrder.filter(id => defaultOrder.includes(id)), ...missing];
  return fullOrder.map(id => {
    const base = ALL_TABS.find(t => t[0] === id);
    if (!base) return null;
    const label = (state.navTabsLabels && state.navTabsLabels[id]) || base[1];
    return [id, label, base[2]];
  }).filter(Boolean);
}

// Поля, видимость которых можно настраивать (применяются на странице "Участок варки")
const CONFIGURABLE_FIELDS = [
  ['client', 'Видеть клиента / заявку'],
  ['note', 'Видеть примечание'],
  ['priority', 'Видеть приоритет'],
  ['dateNavWarshchik', 'Отображать дату'],
  ['dateNavIntake', 'Отображать дату'],
];

// Аудит безопасности — быстрая мера (не архитектурный фикс, см. SECURITY.md «Этап 2»):
// дефолтные пароли больше не совпадают с логином. Применяется только к НОВЫМ ролям /
// сбросу через «Сбросить роли к стандартным» — существующие роли в боевой БД не меняет.
function defaultRoles() {
  return [
    { id:'admin', name:'Админ', login:'admin', password:'ZLFGd6EN',
      tabs: ALL_TABS.map(t=>t[0]),
      fields: { client:true, note:true, priority:true } },
    { id:'operator', name:'Оператор производства', login:'operator', password:'PZft746E',
      tabs: ['dashboard','production','weekplan','calendar','reports','journal'],
      fields: { client:true, note:true, priority:true } },
    { id:'warshchik', name:'Участок варки', login:'warshchik', password:'wUsyGPim',
      tabs: ['warshchik'],
      fields: { client:false, note:true, priority:true, dateNavWarshchik:true, dateNavIntake:true } },
    { id:'intake', name:'Участок розлива', login:'intake', password:'cwr69UQD',
      tabs: ['intake'],
      fields: { client:false, note:true, priority:false, dateNavWarshchik:true, dateNavIntake:true } },
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE DATA
// ════════════════════════════════════════════════════════════════════════════
const SAMPLE_RECIPES = [
  { sku:'JAN-001', name:'Janelli Гель для посуды 0.5л', category:'Посуда', baseBatch:500, tara:0.5, brewHours:3,
    ingredients: [
      {order:1, name:'Вода деионизированная', norm:375, unit:'кг'},
      {order:2, name:'ПАВ анионный (LABSA)',  norm:80,  unit:'кг'},
      {order:3, name:'ПАВ неионогенный',      norm:25,  unit:'кг'},
      {order:4, name:'Хлорид натрия (соль)',  norm:15,  unit:'кг'},
      {order:5, name:'Лимонная кислота',      norm:3,   unit:'кг'},
      {order:6, name:'Краситель',             norm:500, unit:'г'},
      {order:7, name:'Отдушка',               norm:1000,unit:'г'},
    ]},
  { sku:'JAN-002', name:'Janelli Средство для стирки 1л', category:'Стирка', baseBatch:1000, tara:1.0, brewHours:4,
    ingredients: [
      {order:1, name:'Вода деионизированная',  norm:720, unit:'кг'},
      {order:2, name:'ПАВ анионный (LABSA)',   norm:180, unit:'кг'},
      {order:3, name:'Сода кальцинированная',  norm:40,  unit:'кг'},
      {order:4, name:'ПАВ неионогенный',       norm:40,  unit:'кг'},
      {order:5, name:'Энзимы',                 norm:5,   unit:'кг'},
      {order:6, name:'Краситель',              norm:800, unit:'г'},
      {order:7, name:'Отдушка',                norm:1500,unit:'г'},
    ]},
  { sku:'4YOU-001', name:'4You Кондиционер для белья 1л', category:'Кондиционеры', baseBatch:800, tara:1.0, brewHours:3,
    ingredients: [
      {order:1, name:'Вода деионизированная',  norm:620, unit:'кг'},
      {order:2, name:'Эстерквот (DEEDMAC)',    norm:140, unit:'кг'},
      {order:3, name:'Изопропанол',            norm:20,  unit:'кг'},
      {order:4, name:'Лимонная кислота',       norm:2,   unit:'кг'},
      {order:5, name:'Парфюмерная композиция', norm:2000,unit:'г'},
      {order:6, name:'Краситель',              norm:600, unit:'г'},
    ]},
  { sku:'JAN-003', name:'Janelli Чистящее молочко 500мл', category:'Чистящие', baseBatch:500, tara:0.5, brewHours:2,
    ingredients: [
      {order:1, name:'Вода деионизированная', norm:300, unit:'кг'},
      {order:2, name:'Мел (кальцит)',         norm:150, unit:'кг'},
      {order:3, name:'ПАВ неионогенный',      norm:30,  unit:'кг'},
      {order:4, name:'Загуститель',           norm:15,  unit:'кг'},
      {order:5, name:'Отдушка',               norm:1000,unit:'г'},
    ]},
];

const SAMPLE_CLIENTS = ['Каспи', 'Каганат', 'Сайран', 'Хан Шатыр', 'Байтурсынова', 'Кульджинка', 'Алаш', 'Трасса', 'Нура', 'Magnum', 'Small'];

// ════════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ════════════════════════════════════════════════════════════════════════════
function applyStateMigrations() {
  if (!state.recipes || !state.recipes.length) state.recipes = SAMPLE_RECIPES;
  if (!state.clients || !state.clients.length) state.clients = SAMPLE_CLIENTS;
  if (!state.batches) state.batches = [];
  if (!state.requests) state.requests = [];
  // Миграция: если systemEvents ещё не существует — сбрасываем loggedAlarmKeys,
  // чтобы все текущие алармы перелогировались в новый массив systemEvents
  if (!state.systemEvents || !state.systemEvents.length) {
    state.systemEvents = [];
    state.loggedAlarmKeys = {};
  }

  // ── Миграция со старой схемы passwords/roleFields на новую state.roles ──
  if (!state.roles || !state.roles.length) {
    if (state.passwords) {
      // есть старые данные — переносим их в новую структуру, не теряя пароли пользователя
      const legacyWarshchikFields = { client:false, note:true, priority:true, dateNavWarshchik:true, dateNavIntake:true, ...(state.roleFields && state.roleFields.warshchik) };
      state.roles = [
        { id:'admin', name:'Админ', login:'admin', password: state.passwords.admin || 'admin', tabs: ALL_TABS.map(t=>t[0]), fields: { client:true, note:true, priority:true } },
        { id:'operator', name:'Оператор производства', login:'operator', password: state.passwords.operator || 'operator', tabs: ['dashboard','weekplan','calendar','journal'], fields: { client:true, note:true, priority:true } },
        { id:'warshchik', name:'Участок варки', login:'warshchik', password: state.passwords.warshchik || 'warshchik', tabs: ['warshchik'], fields: legacyWarshchikFields },
        { id:'intake', name:'Участок розлива', login:'intake', password: state.passwords.intake || 'intake', tabs: ['intake'], fields: { client:false, note:true, priority:false, dateNavWarshchik:true, dateNavIntake:true } },
      ];
      delete state.passwords;
      delete state.roleFields;
    } else {
      state.roles = defaultRoles();
    }
  }

  // ── Миграция: добавляем роль «Участок розлива», если она ещё не существует ──
  if (!state.roles.find(r => r.tabs && r.tabs.length === 1 && r.tabs[0] === 'intake')) {
    state.roles.push({ id:'intake', name:'Участок розлива', login:'intake', password:'intake', tabs: ['intake'], fields: { client:false, note:true, priority:false, dateNavWarshchik:true, dateNavIntake:true } });
  }

  // ── Переименование уже существующих ролей под новые названия ──
  // (логин, пароль и права не трогаем — меняем только отображаемое имя,
  // и только если оно ещё совпадает со старым стандартным названием)
  const ROLE_RENAME_MAP = {
    'Варщик': 'Участок варки',
    'Приёмка выхода': 'Участок розлива',
    'Оператор': 'Оператор производства',
    'Оператор варочного участка': 'Участок варки',
    'Оператор линии розлива и упаковки': 'Участок розлива',
  };
  state.roles.forEach(r => {
    if (ROLE_RENAME_MAP[r.name]) r.name = ROLE_RENAME_MAP[r.name];
  });

  // ── Новая вкладка «Управление производством» — добавляем существующим ролям,
  // у которых должна быть видна (главный оператор), без сброса остальных настроек ──
  state.roles.forEach(r => {
    if ((r.id === 'admin' || r.id === 'operator') && r.tabs && !r.tabs.includes('production')) {
      r.tabs.push('production');
    }
  });

  if (!state.dashDate) state.dashDate = fmtDate(new Date());
  if (!state.reportsDate) state.reportsDate = fmtDate(new Date());
  if (!state.journalDate) state.journalDate = fmtDate(new Date());
  if (state.journalShowAll === undefined) state.journalShowAll = true; // по умолчанию журнал показывает всю историю
  if (!state.journalStatusFilter) state.journalStatusFilter = 'all';
  if (!state.intakeDate) state.intakeDate = fmtDate(new Date());
  if (state.intakeShowAll === undefined) state.intakeShowAll = true; // по умолчанию вся очередь ожидания, без жёсткого фильтра по дате
  if (!state.warshchikViewDate) state.warshchikViewDate = fmtDate(new Date());
  if (state.warshchikViewingHistory === undefined) state.warshchikViewingHistory = false; // по умолчанию строгий режим "сегодня + просрочка"
  if (!state.recipesSelectedCategory) state.recipesSelectedCategory = null; // null = показываем список категорий
  if (!state.recipeSkuCounter) state.recipeSkuCounter = 1;
  if (state.alarmsCollapsed === undefined) state.alarmsCollapsed = false;
  // Светлая тема — стандарт по умолчанию для всех ролей. Тёмная сохраняется, только если
  // пользователь явно переключил её вручную (themeUserSet). Иначе — принудительно светлая,
  // в т.ч. для старых сохранённых состояний без этого флага.
  if (!state.themeUserSet) state.theme = 'light';
  state.dashHorizon = state.dashHorizon || 'day'; // (устар.) горизонт дашборда
  state.dashPreset = state.dashPreset || 'today';  // пикер периода: 'today'|'7d'|'30d'|'90d'|'custom'
  if (state.dashPreset !== 'custom') state.dashDate = fmtDate(new Date()); // относит. пресеты — от сегодня
  state.dashWeekOffset = 0; // недельные плитки дашборда всегда стартуют с текущей недели
  if (!state.stockLevels) state.stockLevels = {};
  if (!state.wpClients || !state.wpClients.length) state.wpClients = [...state.clients];
  if (!state.wpWeekStart) state.wpWeekStart = getMondayOf(new Date());
  if (!state.wpDemand) state.wpDemand = {};
  if (!state.wpBrewPlan) state.wpBrewPlan = {};
  if (!state.wpGenerated) state.wpGenerated = {};
  if (!state.integrations) state.integrations = { googleSheets: '', telegram: '', email: '' };
  if (state.sheetsUrl && !state.integrations.googleSheets) {
    state.integrations.googleSheets = state.sheetsUrl; // миграция со старого формата
  }
  if (!state.batches.length && !state.requests.length) createDemoData();

  // ── Миграция: партии, созданные до появления стадии «В очереди» и явной передачи
  // в розлив — считаем их уже прошедшими оба гейта, чтобы они не пропали внезапно
  // из очереди варщика/оператора розлива после обновления ──
  state.batches.forEach(b => {
    if (b.sentToBrewing === undefined) b.sentToBrewing = true;
    if (b.sentToPouring === undefined) b.sentToPouring = (b.status === 'done');
    if (b.pouringDate === undefined || b.pouringDate === null) {
      if (b.status === 'done') b.pouringDate = b.brewDate;
    }
    if (b.commentForWarshchik === undefined) b.commentForWarshchik = '';
    if (b.commentForPouring === undefined) b.commentForPouring = '';

    // ── Миграция стадии «Назначена» (assigned) и нового потока варки ──
    // assignedToBrewing — гейт выхода из очереди (заменяет смысл sentToBrewing).
    // Старые партии: если уже передавались в варку (sentToBrewing) — считаем назначенными.
    if (b.assignedToBrewing === undefined) b.assignedToBrewing = !!b.sentToBrewing;
    if (b.assignedBrewingOperatorRoleId === undefined) b.assignedBrewingOperatorRoleId = null;
    if (b.assignedBrewingOperatorName === undefined)   b.assignedBrewingOperatorName = null;
    // Метки старта/финиша варки используют СУЩЕСТВУЮЩИЕ поля brewStartedAt/brewEndedAt
    // (их пишет startBrewTimer/stopBrewTimer). getBatchStage опирается на status, поэтому
    // старые партии (active/done) корректно остаются в brewing/brewed без доп. миграции.
  });

  // ── Реакторов должно быть 7 (Р-1..Р-7). Добавляем недостающие, не удаляя кастомные. ──
  ['Р-1','Р-2','Р-3','Р-4','Р-5','Р-6','Р-7'].forEach(r => {
    if (!state.reactors.includes(r)) state.reactors.push(r);
  });
}

// Загрузка состояния с сервера (GET api/state, требует токен). До входа в
// систему состояние берётся только из localStorage-кэша (логотип/тема для
// экрана логина) — серверное подтянется сразу после логина.
// rev, на котором основан кэш в localStorage — переживает перезагрузку страницы
// (в отличие от _baseRev, который раньше всегда стартовал с 0). Позволяет первой
// же загрузке спросить сервер "?rev=N" вместо безусловного скачивания полного
// state (~650КБ, из них до 350КБ — залогированный base64-логотип): если на
// сервере тот же rev, приходит крошечный {"unchanged":true} и в ход идёт уже
// закэшированный localStorage-снимок.
function _getCachedRev() {
  try { return parseInt(localStorage.getItem('varka_state_rev') || '0', 10) || 0; } catch(e) { return 0; }
}
function _persistStateCache() {
  try {
    localStorage.setItem('varka_state_v2', localStateJson());
    localStorage.setItem('varka_state_rev', String(_baseRev));
  } catch(e) {}
}

async function loadState() {
  let fromServer = false;

  if (db && authToken) {
    try {
      const cachedRev = _getCachedRev();
      const res = await apiFetch('/state' + (cachedRev ? '?rev=' + cachedRev : ''));
      if (res.ok) {
        const j = await res.json();
        if (j.unchanged) {
          // Сервер подтвердил: наш localStorage-кэш ещё актуален — используем его
          // вместо повторной закачки полного блока (см. комментарий у _getCachedRev).
          _baseRev = j.rev || cachedRev;
          try {
            const s = localStorage.getItem('varka_state_v2');
            if (s) state = { ...state, ...JSON.parse(s) };
          } catch(e) {}
          fromServer = true;
          _stateLoadedFromFirestore = true;
          console.info('[API] состояние актуально (кэш) · rev', _baseRev);
        } else if (j.data) {
          state = { ...state, ...j.data };
          _baseRev = j.rev || 0; // запоминаем версию, на которой основаны локальные данные
          _persistStateCache();
          fromServer = true;
          _stateLoadedFromFirestore = true;
          console.info('[API] состояние загружено · rev', _baseRev);
        } else {
          console.warn('[API] состояние на сервере пустое — ждём данных, ничего не пишем');
          _stateLoadedFromFirestore = false;
        }
      } else {
        throw new Error('HTTP ' + res.status);
      }
    } catch(err) {
      if (String(err.message) !== 'unauthorized') {
        console.error('[API] loadState — сервер недоступен:', err);
        _firebaseError = true;
      }
    }
  }

  if (!fromServer) {
    try {
      const s = localStorage.getItem('varka_state_v2');
      if (s) { state = { ...state, ...JSON.parse(s) }; console.info('[Cache] загружено из localStorage'); }
    } catch(e) {}
  }

  applyStateMigrations();
  return fromServer;
}

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  return fmtDate(addDays(d, diff));
}

// _ssoRole — синтетическая роль SSO-сессии портала (см. trySso() ниже).
// Намеренно НЕ часть state.roles: state.roles уходит на сервер при
// saveState()/POST api/state, а эта роль — только для локального рендера
// текущего пользователя, реального role_id в БД у неё нет.
let _ssoRole = null;
function getRoleById(id) {
  if (_ssoRole && id === _ssoRole.id) return _ssoRole;
  return state.roles.find(r => r.id === id);
}

// УРОВЕНЬ ДОСТУПА (2026-07-25) — что человек может делать, отдельно от должности
// (какие разделы видит). Приходит в whoami: 'viewer' | 'manager' | 'admin'.
// У локальных входов под должностью уровня нет — поведение прежнее (могут работать).
function currentLevel() {
  const r = currentUser ? getRoleById(currentUser.roleId) : null;
  if (r && r.level) return r.level;
  return (r && r.fullAccess) ? 'admin' : 'manager';
}
function canEditData() { return currentLevel() !== 'viewer'; }

// Режим «Просмотр»: прячем элементы, которые СУЩЕСТВУЮТ только чтобы менять данные.
// Все обработчики в этом файле — инлайновые onclick, поэтому достаточно прохода по
// DOM. Список явный (не regex по глаголам): так навигация, фильтры, календари и
// выгрузки в Excel гарантированно остаются — «Просмотр» должен полноценно смотреть.
// Защита данных обеспечивается сервером (api/state.php) и saveState(); это — UI.
const VIEWER_HIDDEN_ACTIONS = new Set([
  'addClient','addIngredientRow','addPouringLine','addReactor','addRecipe','addRequestItemRow',
  'assignBrewing','confirmDeleteBatch','confirmDeleteRecipe','confirmResetRolesToDefault',
  'createBatch','createRequest','deleteRoleFromModal','finishBatch',
  'generateProductionFromWeekPlan','markShipped','moveNavTab','openAddRecipeModal',
  'openBatchActions','openCreateRoleModal','openDeleteBatchModal','openEditRoleModal',
  'openSelectWpClientsModal','openSelectWpProductsModal','removeBrandingLogo','removeClient',
  'removePouringLine','removeReactor','rescheduleBatch','resetNavMenuToDefault','saveBranding',
  'saveIngredientsFromModal','saveIntakeQty','saveIntegration','saveRoleFromModal',
  'saveStockLevels','sendToPouring','startBrewTimer','startPouring','stopBrewTimer',
  'stopPouring','toggleWpClient','toggleWpProductModal',
]);
function applyViewerMode() {
  if (canEditData()) return;
  document.querySelectorAll('[onclick]').forEach(el => {
    const m = /^\s*([a-zA-Z_]+)\s*\(/.exec(el.getAttribute('onclick') || '');
    if (m && VIEWER_HIDDEN_ACTIONS.has(m[1])) el.style.display = 'none';
  });
}
// Разделы перерисовываются в разных местах — вместо врезок в каждый рендер один
// наблюдатель за DOM (дешевле и не забудется при будущих правках).
let _viewerModeQueued = false;
function watchViewerMode() {
  const run = () => { _viewerModeQueued = false; applyViewerMode(); };
  new MutationObserver(() => {
    if (_viewerModeQueued) return;
    _viewerModeQueued = true;
    requestAnimationFrame(run);
  }).observe(document.body, { childList: true, subtree: true });
  applyViewerMode();
}

// Светлая/тёмная тема — общая настройка устройства (не привязана к роли),
// сохраняется в state и применяется сразу при загрузке, до входа в систему.
// Является ли текущий вошедший — выделенным оператором варки (единственная вкладка warshchik).
function isBrewOperatorRole() {
  const role = currentUser ? getRoleById(currentUser.roleId) : null;
  return !!(role && !role.fullAccess && role.tabs && role.tabs.length === 1 && role.tabs[0] === 'warshchik');
}

function isPourOperatorRole() {
  const role = currentUser ? getRoleById(currentUser.roleId) : null;
  return !!(role && !role.fullAccess && role.tabs && role.tabs.length === 1 && role.tabs[0] === 'intake');
}

// Любой выделенный участковый оператор — упрощённый мобильный терминал
function isTerminalRole() {
  return isBrewOperatorRole() || isPourOperatorRole();
}

function applyTheme() {
  // Для терминала оператора варки — всегда светлая тема (читаемость в цеху).
  const isLight = isTerminalRole() ? true : (state.theme === 'light');
  document.body.classList.toggle('theme-light', isLight);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = isLight ? '☀️' : '🌙';
}

function toggleTheme() {
  state.theme = (state.theme === 'light') ? 'dark' : 'light';
  state.themeUserSet = true; // пользователь выбрал тему явно — больше не принуждаем к светлой
  saveState();
  applyTheme();
}

// Может ли текущая роль выполнять действия (кнопки, ввод) на данном участке —
// только роль, у которой ЭТА вкладка единственная (то есть выделенная под этот
// участок), может что-то нажимать. Остальные роли (включая Админа и главного
// оператора) видят тот же экран только в режиме наблюдения — статус-текст вместо кнопок.
function canActOnPage(pageId) {
  const role = getRoleById(currentUser.roleId);
  if (!role) return false;
  if (role.fullAccess) return true;
  return role.tabs.length === 1 && role.tabs[0] === pageId;
}

// Проверка прав на конкретное ДЕЙСТВИЕ (не только видимость кнопки). Вызывается
// внутри action-функций, чтобы заблокировать действие даже если кнопка как-то показана.
//   Админ (fullAccess) — всё.
//   Главный оператор (несколько вкладок, включая production) — назначение варки,
//     передача в розлив, мониторинг.
//   Оператор варки (единственная вкладка warshchik) — старт/финиш своих варок.
//   Оператор розлива (единственная вкладка intake) — старт/стоп/факт розлива.
function canDo(action) {
  const role = getRoleById(currentUser ? currentUser.roleId : null);
  if (!role) return false;
  if (role.fullAccess) return true;

  const single = (role.tabs && role.tabs.length === 1) ? role.tabs[0] : null;
  // Диспетчер («главный оператор») — любая роль, которой видна вкладка «Управление
  // производством», независимо от числа вкладок. Раньше требовалось tabs.length > 1,
  // из-за чего выделенная роль с единственной вкладкой 'production' не могла назначать
  // варку/передавать в розлив (форма показывалась, но canDo блокировал действие).
  const isMainOp = role.tabs && role.tabs.includes('production');
  const isBrewOp = single === 'warshchik';
  const isPourOp = single === 'intake';

  switch (action) {
    case 'assignBrewing':
    case 'sendToPouring':
    case 'monitorProduction':
      return isMainOp;
    case 'startBrewing':
    case 'finishBrewing':
    case 'reportBrewProblem':
      return isBrewOp;
    case 'startPouring':
    case 'stopPouring':
    case 'saveIntakeQty':
      return isPourOp;
    default:
      return false;
  }
}

// Все роли, выделенные конкретно под участок розлива (единственная вкладка — intake) —
// это и есть «операторы розлива», у каждого свой логин, без отдельного списка имён.
function getIntakeOperatorRoles() {
  return state.roles.filter(r => r.tabs && r.tabs.length === 1 && r.tabs[0] === 'intake');
}

// Роли участка варки (единственная вкладка — warshchik) — это «операторы варки».
function getBrewingOperatorRoles() {
  return state.roles.filter(r => r.tabs && r.tabs.length === 1 && r.tabs[0] === 'warshchik');
}

// Один оператор не может одновременно отвечать за две разные линии. Возвращает
// линию, на которой этот оператор уже занят (если это другая линия, чем у текущей
// партии), иначе null. Партии, уже дошедшие до "Розлив завершён"/"Готово", не считаются —
// там ответственность оператора по факту уже закрыта.
function getOperatorConflictingLine(roleId, currentBatchLine, excludeBatchId) {
  if (!currentBatchLine) return null;
  const conflict = state.batches.find(b =>
    b.id !== excludeBatchId &&
    b.assignedOperatorRoleId === roleId &&
    b.pouringLine && b.pouringLine !== currentBatchLine &&
    b.status !== 'cancelled' && b.status !== 'deleted' &&
    !['poured','finished'].includes(getBatchStage(b))
  );
  return conflict ? conflict.pouringLine : null;
}

// Записывает действие в Журнал событий. opts: { batchId, batchName, text (готовый текст
// записи), source (Управление производством / Календарь / Участок варки / Участок розлива),
// page, pmStage (куда вести по клику) }. Храним не больше JOURNAL_ENTRIES_MAX последних
// записей, чтобы не разрастаться бесконечно в localStorage.
const JOURNAL_ENTRIES_MAX = 500;
function logJournalEvent(opts) {
  const role = getRoleById(currentUser.roleId);
  if (!state.journalEntries) state.journalEntries = [];
  state.journalEntries.unshift({
    id: 'EV-' + Date.now() + '-' + Math.floor(Math.random()*1000),
    timestamp: new Date().toISOString(),
    roleName: role ? role.name : '—',
    batchId: opts.batchId || null,
    batchName: opts.batchName || null,
    text: opts.text,
    source: opts.source || '—',
    page: opts.page || null,
    pmStage: opts.pmStage || null
  });
  if (state.journalEntries.length > JOURNAL_ENTRIES_MAX) state.journalEntries.length = JOURNAL_ENTRIES_MAX;
}

// ════════════════════════════════════════════════════════════════════════════
// БЕЗОПАСНОСТЬ: САНИТИЗАЦИЯ ТЕКСТА + ЛОКАЛЬНЫЕ РЕЗЕРВНЫЕ КОПИИ
// ════════════════════════════════════════════════════════════════════════════

// Обезвреживание пользовательского текста: угловые скобки заменяются на
// визуально похожие ‹ ›, чтобы введённый текст никогда не исполнялся как HTML
// в innerHTML-рендерах (защита от stored-XSS). Идемпотентно.
function sanitizeUserText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/</g, '‹').replace(/>/g, '›');
}

// Экранирование для безопасной вставки в innerHTML. Нужно там, где значение
// приходит с сервера и могло быть записано другим клиентом (журнал действий):
// санитизация на вводе покрывает только текущий клиент, а записи журнала
// сохранял кто угодно — экранируем на выводе.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// JSON состояния для локального хранения (localStorage-кэш, кольцо бэкапов) с
// вырезанными паролями ролей. Пароль существует в state.roles только между
// вводом в админке и ответом сервера; на диск браузера он попадать не должен
// (сервер хранит только bcrypt-хеш). В памяти state пароль остаётся до POST.
function localStateJson() {
  const clone = { ...state };
  if (Array.isArray(state.roles)) {
    clone.roles = state.roles.map(r => {
      if (r && 'password' in r) { const c = { ...r }; delete c.password; return c; }
      return r;
    });
  }
  return JSON.stringify(clone);
}

// Санитизация всех полей state, куда пользователи вводят произвольный текст.
// Пароли не трогаем (могут содержать любые символы и никогда не рендерятся).
function sanitizeStateUserText() {
  const sT = sanitizeUserText;
  (state.batches || []).forEach(b => { if (b) { b.name = sT(b.name); b.note = sT(b.note); b.client = sT(b.client); } });
  (state.requests || []).forEach(r => { if (r) { r.name = sT(r.name); r.client = sT(r.client); r.note = sT(r.note); } });
  if (Array.isArray(state.clients)) state.clients = state.clients.map(sT);
  if (Array.isArray(state.wpClients)) state.wpClients = state.wpClients.map(sT);
  if (Array.isArray(state.reactors)) state.reactors = state.reactors.map(sT);
  if (Array.isArray(state.pouringLines)) state.pouringLines = state.pouringLines.map(sT);
  (state.recipes || []).forEach(r => { if (r) { r.name = sT(r.name); if (Array.isArray(r.ingredients)) r.ingredients.forEach(i => { if (i) i.name = sT(i.name); }); } });
  (state.roles || []).forEach(r => { if (r) { r.name = sT(r.name); r.login = sT(r.login); } });
  if (state.companyName) state.companyName = sT(state.companyName);
}

// Кольцо локальных резервных копий (последние 5 версий state в localStorage).
// Защита от случайной перезаписи/удаления данных — в т.ч. пришедших извне.
// Восстановление из консоли: varkaBackups() — список, varkaRestoreBackup(N) — откат.
const BACKUP_RING_KEY = 'varka_backup_ring';
function backupRingPush() {
  try {
    if (!state.batches || !state.batches.length) return; // пустое состояние не бэкапим
    const ring = JSON.parse(localStorage.getItem(BACKUP_RING_KEY) || '[]');
    const rev = state._rev || 0;
    if (ring.length && ring[ring.length - 1].rev === rev) return; // эта версия уже есть
    ring.push({ ts: new Date().toISOString(), rev, data: localStateJson() });
    while (ring.length > 5) ring.shift();
    localStorage.setItem(BACKUP_RING_KEY, JSON.stringify(ring));
  } catch (e) {
    // Квота localStorage — оставляем только 2 последние копии
    try {
      const ring = JSON.parse(localStorage.getItem(BACKUP_RING_KEY) || '[]').slice(-2);
      localStorage.setItem(BACKUP_RING_KEY, JSON.stringify(ring));
    } catch (e2) {}
  }
}
function varkaBackups() {
  try {
    return JSON.parse(localStorage.getItem(BACKUP_RING_KEY) || '[]').map((b, i) =>
      ({ n: i, rev: b.rev, ts: b.ts, batches: (JSON.parse(b.data).batches || []).length }));
  } catch (e) { return []; }
}
function varkaRestoreBackup(n) {
  const ring = JSON.parse(localStorage.getItem(BACKUP_RING_KEY) || '[]');
  const b = ring[n];
  if (!b) { alert('Нет такой копии. Список копий: varkaBackups()'); return; }
  if (!confirm('Откатить данные к версии rev ' + b.rev + ' от ' + b.ts + '? Текущее состояние будет заменено.')) return;
  const restored = JSON.parse(b.data);
  restored._rev = state._rev || restored._rev; // сохраняем счётчик версий, чтобы запись не отверглась как устаревшая
  state = { ...state, ...restored };
  saveState();
  render();
  if (typeof showToast === 'function') showToast('Данные восстановлены из локальной копии');
}
// Скачивание полной резервной копии файлом (кнопка в админ-панели)
function downloadStateBackup() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'varka_backup_' + fmtDate(new Date()) + '_rev' + (state._rev || 0) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    if (typeof logActivity === 'function') logActivity('Скачана резервная копия', { target: 'rev ' + (state._rev || 0) });
  } catch (e) { alert('Не удалось сформировать копию: ' + e.message); }
}

function saveState(onResult) {
  // onResult(status) — необязательный колбэк результата записи ('ok'|'stale'|'error'),
  // используется только критичными действиями терминала (см. performCriticalBatchWrite).
  // Обычные вызовы saveState() без аргумента ведут себя ровно как раньше.
  // Применяем входящее обновление (storage другой вкладки / onSnapshot) — НЕ пишем обратно,
  // иначе вкладки зацикливаются: storage→render→saveState→storage→… («зависание» всех разделов).
  if (_applyingRemoteState) return;
  // Уровень «Просмотр» — только чтение. saveState() это ЕДИНСТВЕННАЯ точка записи
  // (78 вызовов по приложению), поэтому одной проверки хватает, чтобы ничего не
  // ушло на сервер. Сервер тоже отклоняет запись (api/state.php) — это источник
  // правды; здесь просто честное сообщение вместо молчаливой неудачи.
  if (!canEditData()) {
    showToast('Уровень «Просмотр» — изменения недоступны');
    if (onResult) onResult('error');
    return;
  }
  sanitizeStateUserText(); // анти-XSS: обезвреживаем пользовательский текст перед сохранением
  backupRingPush();        // локальная резервная копия текущей версии
  // Защита: не писать пустой state в Firestore при инициализации
  if (!_stateLoadedFromFirestore && db) {
    const hasData = (state.batches && state.batches.length > 0) ||
                    (state.recipes && state.recipes.length > 0);
    if (!hasData) {
      console.warn('[Firestore] saveState заблокирован — state пуст и не загружен из Firestore');
      if (onResult) onResult('error');
      return;
    }
  }
  // localStorage — быстрый офлайн-кэш
  try { localStorage.setItem('varka_state_v2', localStateJson()); } catch(e) {}
  // Сервер (api/state) — основное общее хранилище (дебаунс 600 мс)
  if (!db) { if (onResult) onResult('ok'); return; } // сервер недоступен (офлайн) — localStorage уже записан, для критичных действий этого достаточно
  // Сессия истекла/отозвана (db есть, токена нет): НЕ рапортуем успех — иначе
  // критичное действие оператора после 401 показалось бы сохранённым, хотя на
  // сервер не ушло. Возвращаем 'error', чтобы performCriticalBatchWrite не
  // подтверждал успех и показал предупреждение.
  if (!authToken) { if (onResult) onResult('error'); return; }
  // Сразу блокируем фоновый опрос чтобы он не перезаписал локальные изменения
  // до того как дебаунс отработает (иначе UI сбрасывается через ~200ms)
  _snapshotIgnoreUntil = Date.now() + 3600;
  if (saveState._t) clearTimeout(saveState._t);
  saveState._t = setTimeout(() => {
    _snapshotIgnoreUntil = Date.now() + 3000;
    // Запись с baseRev: если на сервере уже более новая версия (чужое устройство
    // успело записать) — сервер вернёт 409 и НЕ даст затереть её устаревшим
    // состоянием. Это защита от массового отката данных «старым» табом/устройством.
    state._updatedAt = new Date().toISOString();
    apiFetch('/state', {
      method: 'POST',
      body: JSON.stringify({ baseRev: _baseRev, data: state }),
    }).then(async res => {
      if (res.status === 409) {
        const j = await res.json();
        console.warn('[API] saveState отменён: на сервере более свежая версия (rev ' +
          (j.rev || '?') + ' > base ' + _baseRev + '). Принимаю свежие данные.');
        _applyRemoteState(j.data);
        if (!onResult && typeof showToast === 'function') showToast('Данные обновлены на другом устройстве — проверьте и повторите действие');
        if (onResult) onResult('stale');
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      _baseRev = j.rev;
      state._rev = j.rev;
      // Пароль роли ушёл на сервер (bcrypt) — убираем его из state в памяти.
      // На диск (localStorage/бэкап) пароль и так не попадал — там localStateJson.
      (state.roles || []).forEach(r => { if (r && 'password' in r) delete r.password; });
      _persistStateCache(); // кэш и его rev теперь соответствуют подтверждённой версии на сервере
      if (onResult) onResult('ok');
    }).catch(err => {
      if (String(err.message) !== 'unauthorized') console.error('[API] saveState:', err);
      if (onResult) onResult('error');
    });
  }, 600);
}

// Обёртка для критичных операторских действий терминала (старт/финиш варки,
// старт/финиш розлива, ввод факта). В отличие от обычного saveState(), знает,
// удалась ли запись, и при отказе (устаревшая версия документа / обрыв сети)
// САМА повторяет ту же мутацию поверх свежих данных — вместо того чтобы тихо
// потерять действие оператора. После исчерпания попыток откатывает локальное
// изменение (чтобы экран не показывал "сделано" при несохранённом факте) и
// явно предупреждает — см. tasks/lessons.md по инциденту с "зависшим" розливом.
function performCriticalBatchWrite(batchId, mutator, callbacks = {}, _retry = {}) {
  const MAX_ATTEMPTS = 3;
  const attempt = _retry.attempt || 1;
  const b = getBatchById(batchId);
  if (!b) return;
  const snapshot = _retry.snapshot || { ...b };
  mutator(b);
  render();
  saveState(status => {
    if (status === 'ok') { if (callbacks.onSuccess) callbacks.onSuccess(getBatchById(batchId)); return; }
    if (attempt < MAX_ATTEMPTS) {
      setTimeout(() => performCriticalBatchWrite(batchId, mutator, callbacks, { attempt: attempt + 1, snapshot }), 500);
      return;
    }
    const fresh = getBatchById(batchId);
    if (fresh) {
      // Object.assign не уберёт поля, которых не было в снимке (например, мутатор
      // впервые проставил pouringStartedAt) — сначала убираем такие «новые» ключи,
      // потом восстанавливаем значения тех, что были.
      Object.keys(fresh).forEach(k => { if (!(k in snapshot)) delete fresh[k]; });
      Object.assign(fresh, snapshot);
    }
    render();
    if (callbacks.onExhausted) callbacks.onExhausted();
    else alert('⚠️ Не удалось сохранить действие — нет связи с сервером.\nПроверьте подключение и повторите.');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// API INIT / SYNC / ACTIVITY LOG (бывший Firebase-слой)
// ════════════════════════════════════════════════════════════════════════════
// Проверка доступности сервера через публичный health-check (api/ping — не
// требует токена, не отдаёт данных проекта; api/report теперь требует
// авторизацию для блока 'pulse', поэтому для простого пинга не годится).
// db=true означает «серверное хранилище доступно» для всего кода ниже.
async function initFirebase() {
  try {
    const res = await fetchWithTimeout(API_BASE + '/ping', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    db = true;
    _fbReady = true;
    console.info('[API] сервер доступен');
  } catch(err) {
    console.error('[API] сервер недоступен:', err.message);
    db = null;
  }
}

// Историческое имя (уровень для журнала действий); авторизацию проверяет сервер.
function getFirebaseRoleLevel(role) {
  if (!role) return 'employee';
  if (role.id === 'admin') return 'admin';
  if (role.tabs && role.tabs.length > 1) return 'manager';
  return 'employee';
}

// Применяет ВХОДЯЩЕЕ состояние из Firestore к локальному без обратной записи.
// Используется и реал-тайм подпиской (onSnapshot), и защитой от устаревшей записи
// (когда наша запись отменена, потому что в облаке оказалась более свежая версия).
function _applyRemoteState(data) {
  if (!data) return;
  backupRingPush(); // страховка: сохраняем текущую локальную версию ДО приёма внешней
  _applyingRemoteState = true;
  try {
    state = { ...state, ...data };
    _baseRev = data._rev || 0; // теперь локальные данные основаны на этой версии
    _persistStateCache();
    applyStateMigrations();
    render();
    const p = document.querySelector('.page.active');
    if (p) {
      const pid = p.id.replace('page-', '');
      if      (pid === 'warshchik')  renderWarshchikBatches();
      else if (pid === 'intake')     renderIntake();
      else if (pid === 'production') renderProductionManagement();
      else if (pid === 'weekplan')   renderWeekPlan();
      else if (pid === 'calendar')   renderCalendar();
      else if (pid === 'reports')    renderReports();
      else if (pid === 'journal')    renderJournal();
      else if (pid === 'dashboard')  renderDashboard();
    }
  } finally { _applyingRemoteState = false; }
}

// Realtime-подписка Firestore заменена фоновым опросом: раз в 15 секунд (только
// в видимой вкладке и только после входа) сверяем rev на сервере и принимаем
// более свежее состояние. Для темпа работы цеха этого достаточно; окно
// _snapshotIgnoreUntil работает так же, как при onSnapshot.
const STATE_POLL_MS = 15000;
function setupFirestoreSync() {
  if (!db) return;
  if (setupFirestoreSync._t) return; // уже запущен
  setupFirestoreSync._t = setInterval(() => {
    if (!authToken || document.hidden) return;
    if (Date.now() < _snapshotIgnoreUntil) return;
    _resyncFromFirestore();
  }, STATE_POLL_MS);
}

// Принудительный ресинк при возврате к вкладке: фоновый/«уснувший» таб мог пропустить
// обновления. Подтягиваем свежую версию ДО того, как пользователь что-то нажмёт,
// чтобы устаревший таб не работал поверх протухших данных.
function _resyncFromFirestore() {
  if (!db || !authToken) return;
  // Передаём свой rev: если на сервере тот же — вернётся {unchanged:true} (~30
  // байт) вместо всего состояния (~650КБ). Опрос идёт с каждого устройства
  // каждые 15с, поэтому пустой ответ при неизменном rev экономит трафик/CPU.
  apiFetch('/state?rev=' + _baseRev).then(async res => {
    if (!res.ok) return;
    const j = await res.json();
    if (j.unchanged || !j.data) return;
    if (Date.now() < _snapshotIgnoreUntil) {
      // Даже в окне подавления (после нашей же записи) обновляем _baseRev — чтобы знать
      // самую свежую версию и не считать себя «устаревшими» из-за собственного эха.
      if ((j.rev || 0) > _baseRev) _baseRev = j.rev;
      return;
    }
    if ((j.rev || 0) > _baseRev) _applyRemoteState(j.data);
  }).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) _resyncFromFirestore(); });
window.addEventListener('focus', _resyncFromFirestore);

function logActivity(action, opts) {
  if (!db || !authToken) return;
  const role = currentUser ? getRoleById(currentUser.roleId) : null;
  const entry = {
    userId:     currentUser ? currentUser.roleId : 'system',
    userName:   role ? role.login    : '—',
    role:       role ? getFirebaseRoleLevel(role) : '—',
    roleName:   role ? role.name     : '—',
    action,
    target:     opts && opts.target  ? String(opts.target)  : '',
    before:     opts && opts.before  !== undefined ? JSON.parse(JSON.stringify(opts.before)) : null,
    after:      opts && opts.after   !== undefined ? JSON.parse(JSON.stringify(opts.after))  : null,
    details:    opts && opts.details ? JSON.parse(JSON.stringify(opts.details)) : {},
    createdAt:  new Date().toISOString(),
    tsMs:       Date.now(),
    deviceInfo: {
      ua:       navigator.userAgent.slice(0, 200),
      screen:   `${screen.width}x${screen.height}`,
      lang:     navigator.language,
    },
  };
  return apiFetch('/activity', { method: 'POST', body: JSON.stringify(entry) }).catch(() => {});
}

async function renderActivityLog() {
  const el = document.getElementById('admin-activitylog-list');
  if (!el) return;
  if (!db) { el.innerHTML = '<div style="padding:20px;color:var(--text2);text-align:center;">Сервер недоступен</div>'; return; }
  // «Тихая загрузка» — платформенный паттерн (решение владельца 2026-07-21):
  // пустая область вместо надписи «Загрузка...» на время запроса; итоговые
  // состояния («Журнал пуст», «Сервер недоступен») остаются как были.
  el.innerHTML = '';
  try {
    const res = await apiFetch('/activity');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const entries = await res.json(); // последние 200, новые первыми
    if (!entries.length) { el.innerHTML = '<div style="padding:20px;color:var(--text2);text-align:center;">Журнал пуст</div>'; return; }
    el.innerHTML = entries.map(e => {
      const dt = new Date(e.tsMs || e.createdAt || e.ts).toLocaleString('ru-RU');
      // Все поля — с сервера (могли быть записаны другим клиентом), экранируем.
      const det = e.details && Object.keys(e.details).length ? `<div style="margin-top:3px;color:var(--text3);font-size:11px;word-break:break-all;">${escapeHtml(JSON.stringify(e.details))}</div>` : '';
      const ua = (e.deviceInfo && e.deviceInfo.ua) || e.ua || '';
      return `<div style="padding:10px 14px;border-bottom:1px solid var(--border);">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
          <span style="font-weight:700;color:var(--accent);">${escapeHtml(e.userName||'—')}</span>
          <span style="font-size:11px;color:var(--text2);">${escapeHtml(e.roleName||e.userRole||'')}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text3);">${escapeHtml(dt)}</span>
        </div>
        <div style="margin-top:3px;font-size:13px;color:var(--text);">${escapeHtml(e.action)}${e.target?' · '+escapeHtml(e.target):''}</div>
        ${det}
        <div style="margin-top:2px;font-size:10px;color:var(--text3);opacity:.6;">${escapeHtml(String(ua).slice(0,80))}</div>
      </div>`;
    }).join('');
  } catch(err) {
    el.innerHTML = `<div style="padding:20px;color:var(--danger);">Ошибка: ${err.message}</div>`;
  }
}

function createDemoData() {
  const today = fmtDate(new Date());
  // demo batches (direct, no request)
  state.batches = [
    mkBatch({ sku:'JAN-001', volume:500, tara:0.5, reactor:'Р-1', priority:1, status:'active', note:'Срочно в магазин', brewDate: today, brewHours: 3 }),
    mkBatch({ sku:'JAN-002', volume:1000, tara:1.0, reactor:'Р-2', priority:2, status:'planned', note:'', brewDate: today, brewHours: 4 }),
  ];
  state.batchCounter = 3;

  // demo request
  const req = mkRequest({
    client: 'Magnum',
    items: [{ sku:'4YOU-001', qty: 800 }],
    shipDate: fmtDate(addDays(new Date(), 3)),
    brewDate: fmtDate(addDays(new Date(), 1)),
    brewHours: 3,
    reactor: 'Р-3'
  });
  state.requests = [req];
  state.requestCounter = 2;
}

function fmtDate(d) {
  // returns YYYY-MM-DD
  if (typeof d === 'string') return d;
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function fmtDateHuman(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate()+n);
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════════════════
// Вход теперь проверяет ТОЛЬКО сервер (POST api/auth, bcrypt): паролей в state
// больше нет. Неудачные попытки фиксирует сервер (login_log + rate limit 10/15мин).
async function doLogin() {
  const login = (document.getElementById('login-username').value || '').trim();
  const pwd = (document.getElementById('login-password').value || '').trim();
  const errEl = document.getElementById('login-error');
  errEl.style.color = 'var(--danger)';
  if (!login || !pwd) { errEl.textContent = 'Введите логин и пароль'; return; }
  errEl.textContent = '';

  let res, j;
  try {
    res = await fetch(API_BASE + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: pwd }),
    });
    j = await res.json();
  } catch(e) {
    errEl.textContent = 'Нет связи с сервером — попробуйте ещё раз';
    return;
  }
  if (!res.ok) {
    errEl.textContent = (j && j.error) ? j.error : 'Неверный логин или пароль';
    return;
  }

  authToken = j.token;
  // Сервер ответил на /auth — значит он доступен. Если стартовый ping в
  // initFirebase не прошёл (кратковременный сбой при загрузке), db остался null,
  // и без этого loadState/saveState/опрос молча ушли бы в офлайн на всю смену.
  db = true; _fbReady = true; _firebaseError = false;
  const banner = document.getElementById('firebase-error-banner');
  if (banner) banner.remove();
  currentUser = { roleId: j.role.id, loginAt: Date.now() };
  try { sessionStorage.setItem('varka_session', JSON.stringify({ ...currentUser, token: authToken })); } catch(e) {}

  // Свежее состояние — с токеном (до входа был доступен только localStorage-кэш).
  await loadState();
  // Роль с сервера — источник правды на случай, если кэш state.roles устарел.
  const idx = (state.roles || []).findIndex(r => r.id === j.role.id);
  if (idx >= 0) state.roles[idx] = { ...state.roles[idx], ...j.role };

  const role = getRoleById(j.role.id) || j.role;
  logActivity('Вход в систему', { target: role.login, details: { roleName: role.name, level: getFirebaseRoleLevel(role) } });
  enterApp();
  setupFirestoreSync();
}

function confirmResetRolesToDefault() {
  const ok = confirm('Сбросить все роли к стандартным? Все созданные вручную роли будут удалены, пароли admin/operator/warshchik/intake вернутся к значениям по умолчанию.');
  if (!ok) return;
  state.roles = defaultRoles();
  saveState();
  renderRolesList();
  showToast('Роли сброшены к стандартным значениям');
}

let _loggingOut = false; // подавляет ложное «Сессия истекла» при штатном выходе
async function doLogout() {
  _loggingOut = true;
  // Сначала дожидаемся записи «Выход» (пока токен ещё жив), ПОТОМ гасим сессию —
  // иначе /logout мог обогнать /activity, тот получил бы 401 и показал ложное
  // «Сессия истекла — войдите заново», а запись о выходе потерялась бы.
  try { await logActivity('Выход из системы', { target: currentUser ? currentUser.roleId : '' }); } catch(e) {}
  if (authToken) { try { await apiFetch('/logout', { method: 'POST' }); } catch(e) {} }
  authToken = null;
  currentUser = null;
  document.body.classList.remove('role-terminal');
  document.body.classList.remove('role-brewop');
  document.body.classList.remove('role-pourop');
  document.body.classList.remove('terminal-detail-open');
  try { sessionStorage.removeItem('varka_session'); } catch(e) {}
  document.getElementById('app-shell').style.display = 'none';
  _loggingOut = false;
  // Единый вход платформы (решение владельца 2026-07-21): своей формы входа
  // у Manufacture больше нет — после выхода уводим на портал varka.kz.
  window.location.replace('https://varka.kz/');
}

function toggleSidebar() {
  const layout = document.getElementById('app-layout');
  const collapsed = layout.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('varka_sidebar_collapsed', collapsed ? '1' : '0'); } catch(e) {}
  updateSidebarEdgeBtn(collapsed);
}

function updateSidebarEdgeBtn(collapsed) {
  const icon = document.getElementById('sidebar-edge-icon');
  if (!icon) return;
  const poly = icon.querySelector('polyline');
  if (poly) poly.setAttribute('points', collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6');
}

function applySidebarState() {
  const layout = document.getElementById('app-layout');
  if (!layout) return;
  let collapsed = '0';
  try { collapsed = localStorage.getItem('varka_sidebar_collapsed') || '0'; } catch(e) {}
  layout.classList.toggle('sidebar-collapsed', collapsed === '1');
  updateSidebarEdgeBtn(collapsed === '1');
}

// SSO поверх локального логина (шаг 5 ТЗ, не заменяет его). Portal (varka.kz)
// и Manufacture (varka.kz/manufacture) — общий origin с переезда на пути,
// поэтому portal_token из sessionStorage портала уже доступен этой странице
// напрямую, без обмена токеном между проектами. Вызывается из INIT ниже,
// только если tryRestoreSession() не нашёл локальную сессию Manufacture —
// локальный логин в приоритете, SSO — запасной путь.
const SSO_ROLE_ID = '__portal_sso__';
// Разовая миграция: раньше логотип хранился как base64 прямо в state.companyLogo
// (до ~350КБ — половина всего state, качались целиком на каждой загрузке страницы).
// При первом же входе админа после этой правки переносим его в статический файл
// (api/branding.php) и оставляем в state только короткую ссылку. Fire-and-forget —
// не блокирует вход; если сервер недоступен, просто попробуем на следующей загрузке.
async function migrateLegacyLogo() {
  if (!state.companyLogo || state.companyLogoUrl) return;
  const role = getRoleById(currentUser.roleId);
  if (!role || !role.tabs || !role.tabs.includes('admin')) return; // endpoint админ-only
  try {
    const res = await fetchWithTimeout(API_BASE + '/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ dataUrl: state.companyLogo }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    state.companyLogoUrl = j.url;
    delete state.companyLogo;
    saveState();
    applyBranding();
    updateBrandingLogoPreview();
    console.info('[Branding] логотип перенесён из state в статический файл:', j.url);
  } catch (e) {
    console.error('[Branding] миграция логотипа не удалась, попробуем при следующей загрузке:', e);
  }
}

async function trySso() {
  // localStorage, не sessionStorage — портал открывает Manufacture в новой
  // вкладке (target=_blank), sessionStorage между вкладками не расшаривается.
  const portalToken = localStorage.getItem('portal_token');
  if (!portalToken) return false;
  try {
    const res = await fetchWithTimeout(API_BASE + '/whoami', {
      headers: { Authorization: 'Bearer ' + portalToken },
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.role) return false;
    _ssoRole = { ...data.role, id: SSO_ROLE_ID };
    authToken = portalToken;
    currentUser = { roleId: SSO_ROLE_ID, loginAt: Date.now() };
    return true;
  } catch (e) {
    return false; // портал недоступен/офлайн — остаёмся на локальном логине
  }
}

// Аудит безопасности §1: TTL сессии — 12 часов (рабочая смена с запасом). Без loginAt
// (сессии, созданные до этой правки) считаем устаревшими — безопаснее, чем доверять бессрочно.
const SESSION_TTL_MS = 12 * 3600 * 1000;
function tryRestoreSession() {
  try {
    const s = sessionStorage.getItem('varka_session');
    if (s) {
      const parsed = JSON.parse(s);
      const fresh = parsed && parsed.loginAt && (Date.now() - parsed.loginAt) <= SESSION_TTL_MS;
      // Настоящую проверку токена делает сервер: первый же запрос с протухшим/
      // отозванным токеном вернёт 401 → handleAuthExpired() покажет экран входа.
      if (fresh && parsed.roleId && parsed.token) {
        authToken = parsed.token;
        currentUser = { roleId: parsed.roleId, loginAt: parsed.loginAt };
        return true;
      }
      sessionStorage.removeItem('varka_session'); // истекла или битая — не оставляем висеть
    }
  } catch(e) {}
  return false;
}

// Подставляет в заголовки страниц текущие названия пунктов меню (с учётом
// переименования админом) — чтобы заголовок страницы и пункт меню всегда совпадали.
function applyNavLabelsToPageHeaders() {
  const tabs = getEffectiveTabs();
  const find = id => tabs.find(t => t[0] === id);

  [['dashboard','page-title-dashboard'], ['production','page-title-production'], ['weekplan','page-title-weekplan'], ['calendar','page-title-calendar'], ['warshchik','page-title-warshchik'],
   ['intake','page-title-intake'], ['reports','page-title-reports'], ['journal','page-title-journal'], ['admin','page-title-admin']].forEach(([id, elId]) => {
    const t = find(id);
    const el = document.getElementById(elId);
    if (el && t) el.innerHTML = `${t[2]} ${t[1]}`;
  });
}

// Перестраивает боковое меню (порядок/названия пунктов) для текущего пользователя.
// Используется и при входе в систему, и сразу после того как админ поменял порядок
// или название пункта меню — без необходимости перезаходить в систему.
function refreshNavTabs() {
  const role = getRoleById(currentUser.roleId);
  if (!role) return [];
  const effectiveTabs = getEffectiveTabs();
  const tabs = effectiveTabs.filter(t => (role.tabs || []).includes(t[0]));
  const navEl = document.getElementById('nav-tabs');
  if (navEl) {
    // сохраняем текущую открытую страницу, чтобы переименование/перестановка пунктов
    // не сбрасывала пользователя на первую вкладку
    const activeEl = document.querySelector('.page.active');
    const activePage = activeEl ? activeEl.id.replace('page-', '') : null;
    navEl.innerHTML = tabs.map((t,i) => `<button class="nav-tab ${t[0]===activePage ? 'active' : (!activePage && i===0 ? 'active' : '')}" data-page="${t[0]}" onclick="showPage('${t[0]}', this)" title="${t[1]}"><span class="nav-tab-icon">${t[2]||'•'}</span><span class="nav-tab-label">${t[1]}</span></button>`).join('');
  }
  applyNavLabelsToPageHeaders();

  // у роли с ровно одной доступной вкладкой боковая панель не несёт навигационной
  // пользы (нет выбора) — прячем её совсем, контент занимает всю ширину
  const sidebarEl = document.getElementById('sidebar');
  const toggleBtn = document.querySelector('.sidebar-toggle-btn');
  const isSingleTabRole = tabs.length === 1;
  if (sidebarEl) sidebarEl.style.display = isSingleTabRole ? 'none' : '';
  if (toggleBtn) toggleBtn.style.display = isSingleTabRole ? 'none' : '';

  // recipe add button — только если роль имеет доступ к админ-панели
  const addRecipeBtn = document.getElementById('btn-add-recipe');
  if (addRecipeBtn) addRecipeBtn.style.display = role.tabs.includes('admin') ? 'inline-flex' : 'none';

  return tabs;
}

function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  applySidebarState();
  applyTheme();
  applyBranding();
  clearPmStage();

  const role = getRoleById(currentUser.roleId);
  if (!role) { doLogout(); return; }

  // Упрощённый мобильный режим для выделенных участковых операторов
  document.body.classList.toggle('role-terminal', isTerminalRole());
  document.body.classList.toggle('role-brewop', isBrewOperatorRole());
  document.body.classList.toggle('role-pourop', isPourOperatorRole());

  // Уровень «Просмотр» — прячем кнопки изменения (см. applyViewerMode).
  document.body.classList.toggle('level-viewer', !canEditData());
  watchViewerMode();

  const pill = document.getElementById('user-role-pill');
  pill.textContent = role.login ? `${role.name} ${role.login}` : role.name;
  pill.className = 'role-pill'; // динамические роли используют единый нейтральный стиль pill

  const tabs = refreshNavTabs();

  if (tabs.length) showPage(tabs[0][0]);
  render();
}

// ════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════════
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${id}`).classList.add('active');
  if (btn) btn.classList.add('active');
  else { const b = document.querySelector(`.nav-tab[data-page="${id}"]`); if (b) b.classList.add('active'); }
  if (id === 'warshchik') {
    state.currentBatchId = null;
    document.body.classList.remove('terminal-detail-open');
    document.getElementById('warshchik-detail').style.display = 'none';
    document.getElementById('warshchik-list').style.display = 'block';
    state.warshchikViewingHistory = false;
    state.warshchikViewDate = fmtDate(new Date());
  }
  if (id === 'intake') {
    state.currentPouringId = null;
    document.body.classList.remove('terminal-detail-open');
    const idt = document.getElementById('intake-detail');
    if (idt) idt.style.display = 'none';
    const il = document.getElementById('intake-list'); if (il) il.style.display = 'block';
  }
  if (id !== 'production') { clearPmStage(); }
  if (id === 'calendar') renderCalendar();
  if (id === 'weekplan') renderWeekPlan();
  if (id === 'admin') closeAdminSection();
  render();
  const _main = document.querySelector('.app-main');
  if (_main) _main.scrollTop = 0;
}

// ════════════════════════════════════════════════════════════════════════════
// RECIPE HELPERS
// ════════════════════════════════════════════════════════════════════════════
function calcIngredients(sku, volume) {
  const recipe = state.recipes.find(r => r.sku === sku);
  if (!recipe) return [];
  const ratio = volume / recipe.baseBatch;
  return recipe.ingredients.map(ing => ({
    ...ing,
    normFact: Math.round(ing.norm * ratio * 1000) / 1000
  }));
}
function nextBatchId() {
  // Гарантируем уникальность ID: пропускаем номера, уже занятые ЛЮБОЙ партией (включая
  // мягко удалённые — они остаются в state.batches для журнала). Иначе счётчик, отставший
  // после сброса/демо-данных, выдавал бы дубликат ID → коллизия, и действия (назначение,
  // старт варки и т.д.) попадали бы на не ту копию партии.
  let id;
  do { id = `П-${String(state.batchCounter).padStart(3,'0')}`; state.batchCounter++; }
  while (state.batches.some(b => b.id === id));
  return id;
}

// Безопасный поиск партии по id. ВАЖНО: id могут дублироваться (мягко удалённые партии
// остаются в массиве, а старый счётчик мог переиспользовать номер). При коллизии берём
// ЖИВУЮ (не удалённую) партию — иначе действия попадали бы на удалённую копию, а реальная
// queued-партия не двигалась (баг «назначил — а в Назначена не попало»).
function getBatchById(id) {
  return state.batches.find(b => b.id === id && b.status !== 'deleted')
      || state.batches.find(b => b.id === id);
}
function nextRequestId() { const id = `З-${String(state.requestCounter).padStart(3,'0')}`; state.requestCounter++; return id; }

// Транслитерация кириллицы для генерации латинского SKU-префикса
const TRANSLIT_MAP = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function transliterate(str) {
  return str.toLowerCase().split('').map(ch => TRANSLIT_MAP[ch] !== undefined ? TRANSLIT_MAP[ch] : ch).join('');
}

function generateSku(name) {
  const firstWord = (name.trim().split(/\s+/)[0] || 'SKU');
  const translit = transliterate(firstWord).toUpperCase().replace(/[^A-Z]/g, '');
  const prefix = (translit || 'SKU').slice(0, 4);
  let sku;
  do {
    sku = `${prefix}-${String(state.recipeSkuCounter).padStart(3,'0')}`;
    state.recipeSkuCounter++;
  } while (state.recipes.some(r => r.sku === sku));
  return sku;
}

function mkBatch(opts) {
  const recipe = state.recipes.find(r => r.sku === opts.sku);
  const planQty = Math.floor(opts.volume / opts.tara);
  return {
    id: nextBatchId(),
    date: fmtDate(new Date()),
    sku: opts.sku, name: recipe.name, volume: opts.volume, tara: opts.tara, planQty,
    reactor: opts.reactor, priority: opts.priority || 3, status: opts.status || 'planned',
    note: opts.note || '', brewDate: opts.brewDate || fmtDate(new Date()),
    brewHours: opts.brewHours || recipe.brewHours || 2,
    requestId: opts.requestId || null,
    weekPlanSource: opts.weekPlanSource || null,
    ingredients: calcIngredients(opts.sku, opts.volume),
    factQty: null, factIngredients: {},
    pouringLine: null, pouringOperatorName: null,
    assignedOperatorRoleId: null, // конкретная роль-оператор розлива, если назначена заранее — партия видна только ей
    // ── стадия «В очереди» и далее по цепочке (см. getBatchStage) ──
    sentToBrewing: false,   // главный оператор нажал «Передать в варку» — иначе партия лежит в «В очереди», варщик её не видит
    sentToPouring: false,   // главный оператор нажал «Передать в розлив» — иначе партия лежит в «Варка завершена», оператор розлива её не видит
    pouringDate: null,      // дата розлива (аналог даты варки) — оператор розлива видит партию только в этот день
    commentForWarshchik: opts.commentForWarshchik || '',
    commentForPouring: opts.commentForPouring || ''
  };
}

// ════════════════════════════════════════════════════════════════════════════
// СТАДИЯ ПАРТИИ — единая логика на основе существующих полей + новых гейтов
// передачи. Используется вкладками «Управления производством», индикаторами
// реакторов/линий и алармами, чтобы не дублировать эту логику в разных местах.
// Возможные значения: 'queued' (В очереди), 'brewing' (Идёт варка),
// 'brewed' (Варка завершена), 'pouring' (Идёт розлив), 'poured' (Розлив завершён),
// 'finished' (Готово), 'cancelled', 'deleted'.
// ════════════════════════════════════════════════════════════════════════════
function getBatchStage(b) {
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'deleted') return 'deleted';

  // гейт выхода из очереди: assignedToBrewing (новое) ИЛИ sentToBrewing (старое, backward-compat)
  const assigned = b.assignedToBrewing || b.sentToBrewing;
  if (!assigned) return 'queued';

  // партия назначена, но варщик ещё не нажал «Начать варку»
  // (статус не active/done И нет фактической метки старта brewStartedAt)
  if (b.status !== 'active' && b.status !== 'done' && !b.brewStartedAt) return 'assigned';

  // варка идёт: статус active (или есть метка старта), но ещё не завершена
  if (b.status !== 'done' && !b.brewEndedAt) return 'brewing';

  // варка завершена (status done или есть метка финиша)
  // «Сварено» — пока оператор розлива не нажал «Начать розлив» (pouringStartedAt)
  if (!b.sentToPouring || !b.pouringStartedAt) return 'brewed';
  if (!b.pouringEndedAt) return 'pouring';
  if (b.factQty === null || b.factQty === undefined) return 'poured';
  return 'finished';
}

// Статус реактора для индикатора — точка + текст вместо цифры. Смотрим на партии,
// у которых брюдата не в будущем (сегодня/просрочено), и берём самую «горячую»:
// разливается > варится > сварено, ждёт розлива > назначена, не начато > свободен.
function reactorIndicatorState(reactorName) {
  const today = fmtDate(new Date());
  const relevant = state.batches.filter(b => b.reactor === reactorName && b.status !== 'cancelled' && b.status !== 'deleted' && b.brewDate <= today);
  if (relevant.find(b => getBatchStage(b) === 'pouring')) return { color: 'green', text: 'Розлив' };
  if (relevant.find(b => b.status === 'active')) return { color: 'orange', text: 'Варится' };
  if (relevant.find(b => getBatchStage(b) === 'brewed')) return { color: 'blue', text: 'Ждёт розлива' };
  // «Назначена» — только если партия реально передана оператору варки (тот же гейт,
  // что и у варщика в brewReactorState). Иначе queued-партия фальшиво выглядела «назначенной».
  if (relevant.find(b => getBatchStage(b) === 'assigned')) return { color: 'red', text: 'Назначена' };
  // партия лежит в очереди (не назначена) — на участке варки реактор ещё не занят варщиком,
  // но задача уже есть: показываем честно «В очереди», а не «Свободен» и не «Назначена».
  if (relevant.find(b => getBatchStage(b) === 'queued')) return { color: 'gray', text: 'В очереди' };
  return { color: 'white', text: 'Свободен' };
}

// Статус линии розлива — четыре состояния: свободна / зарезервирована заранее
// (партия ещё варится, до розлива далеко — мигает) / назначена, не начато
// (партия уже сварена и передана в розлив, но физически не начато — пульсирует) /
// разливается (пульсирует).
function lineIndicatorState(lineName) {
  const candidates = state.batches.filter(b => b.pouringLine === lineName && b.status !== 'cancelled' && b.status !== 'deleted' &&
    !['poured','finished'].includes(getBatchStage(b)));
  const activePouring = candidates.find(b => getBatchStage(b) === 'pouring' && b.pouringStartedAt);
  if (activePouring) return { color: 'green', text: activePouring.pouringOperatorName ? `Разлив · ${activePouring.pouringOperatorName}` : 'Розлив' };
  if (candidates.find(b => getBatchStage(b) === 'brewed' || (getBatchStage(b) === 'pouring' && !b.pouringStartedAt))) return { color: 'red', text: 'Не начато' };
  if (candidates.find(b => ['queued','brewing'].includes(getBatchStage(b)))) return { color: 'yellow', text: 'Забронирована' };
  return { color: 'white', text: 'Свободна' };
}

const BATCH_STAGE_LABELS = {
  queued: 'В очереди', brewing: 'Идёт варка', brewed: 'Варка завершена',
  pouring: 'Идёт розлив', poured: 'Розлив завершён', finished: 'Готово',
  cancelled: 'Отменено', deleted: 'Удалено'
};

function mkRequest(opts) {
  // opts: client, items:[{sku,qty}], shipDate, brewDate, brewHours, reactor
  const id = nextRequestId();
  const today = fmtDate(new Date());
  const itemsWithDetails = opts.items.map(it => {
    const recipe = state.recipes.find(r => r.sku === it.sku);
    const volume = it.qty * recipe.tara; // qty (шт) * tara(л/шт) = объём кг (approx 1л=1кг для ПАВ растворов)
    return { sku: it.sku, name: recipe.name, qty: it.qty, tara: recipe.tara, volume: Math.round(volume*10)/10 };
  });
  const req = {
    id, date: today, client: opts.client, items: itemsWithDetails,
    shipDate: opts.shipDate, brewDate: opts.brewDate, brewHours: opts.brewHours,
    reactor: opts.reactor, status: 'new', batchIds: []
  };
  // auto-create batches for each item
  itemsWithDetails.forEach(it => {
    const priority = calcPriorityFromShipDate(opts.shipDate);
    const batch = mkBatch({
      sku: it.sku, volume: it.volume, tara: it.tara, reactor: opts.reactor,
      priority, status: 'planned', brewDate: opts.brewDate, brewHours: opts.brewHours,
      requestId: id, note: `Заявка ${id} · ${opts.client}`
    });
    state.batches.push(batch);
    req.batchIds.push(batch.id);
  });
  return req;
}

function calcPriorityFromShipDate(shipDate) {
  const days = (new Date(shipDate) - new Date(fmtDate(new Date()))) / 86400000;
  if (days <= 1) return 1;
  if (days <= 3) return 2;
  if (days <= 7) return 3;
  return 4;
}

function requestProgress(req) {
  const batches = req.batchIds.map(id => getBatchById(id)).filter(Boolean);
  const totalPlan = req.items.reduce((s,i) => s + i.qty, 0);
  const totalFact = batches.reduce((s,b) => s + (b.factQty || 0), 0);
  const allDone = batches.length && batches.every(b => b.status === 'done');
  return { totalPlan, totalFact, allDone, batches };
}

// auto-update request status based on batches AND brew date arrival
function syncRequestStatuses() {
  const today = fmtDate(new Date());
  state.requests.forEach(req => {
    if (req.status === 'shipped') return;
    const prog = requestProgress(req);
    if (prog.allDone) {
      req.status = 'ready';
    } else if (prog.batches.some(b => b.status === 'active' || b.status === 'done') || req.brewDate <= today) {
      // день варки настал (или уже прошёл) — заявка официально в производстве,
      // даже если варщик физически ещё не нажал "начать"
      req.status = 'in_production';
    } else {
      req.status = 'new';
    }
  });
}

function reactorColor(r) {
  const idx = state.reactors.indexOf(r);
  return idx >= 0 ? (idx % 8) + 1 : 1;
}

// Имитация заполнения реактора по времени — НЕ реальные данные с датчиков.
// Считаем процент готовности от того, сколько реального времени прошло с
// момента старта варки относительно плановой длительности (brewHours).
function getBrewProgressPct(b) {
  if (b.status === 'done') return 100;
  if (b.status !== 'active' || !b.brewStartedAt) return 0;
  const elapsedMs = new Date() - new Date(b.brewStartedAt);
  const totalMs = (b.brewHours || 1) * 3600000;
  const pct = Math.min(99, Math.round(elapsedMs / totalMs * 100)); // не доходит до 100% само — только варщик подтверждает финал
  return Math.max(0, pct);
}

function statusLabel(s) {
  const m = { planned:'В очереди', active:'В работе', done:'Готово', cancelled:'Отменено', deleted:'Удалено', new:'Новая', in_production:'В производстве', ready:'Готова к отгрузке', shipped:'Отгружена' };
  return m[s] || s;
}
function priorityLabel(p) {
  const m = { '1':'Срочно','2':'Высокий','3':'Обычный','4':'Низкий' };
  return m[String(p)] || 'Обычный';
}

// ════════════════════════════════════════════════════════════════════════════
// CONFLICT CHECK — reactor + date + hours overlap (рабочий день начинается в 08:00)
// ════════════════════════════════════════════════════════════════════════════
const WORKDAY_START_HOUR = 8;

function getReactorDayLoad(reactor, date, excludeBatchId) {
  return state.batches
    .filter(b => b.reactor === reactor && b.brewDate === date && b.status !== 'cancelled' && b.status !== 'deleted' && b.id !== excludeBatchId)
    .reduce((sum, b) => sum + (b.brewHours || 0), 0);
}

// Раскладывает варки реактора по реальному времени: первая стартует в 08:00,
// каждая следующая — сразу после окончания предыдущей (по порядку приоритета)
function computeReactorSchedule(reactor, date) {
  const batches = state.batches
    .filter(b => b.reactor === reactor && b.brewDate === date && b.status !== 'cancelled' && b.status !== 'deleted');

  // варки с явно заданным временем (после перетаскивания) ставим на своё место;
  // остальные авто-укладываем по приоритету в оставшиеся промежутки, начиная с 8:00
  const pinned = batches.filter(b => b.scheduledHour !== undefined && b.scheduledHour !== null)
    .map(b => ({ batch: b, startHour: b.scheduledHour, endHour: b.scheduledHour + (b.brewHours||0) }))
    .sort((a,b) => a.startHour - b.startHour);
  const unpinned = batches.filter(b => b.scheduledHour === undefined || b.scheduledHour === null)
    .sort((a,b) => a.priority - b.priority);

  const result = [...pinned];
  let cursor = WORKDAY_START_HOUR;
  unpinned.forEach(b => {
    // пропускаем интервалы, занятые уже закреплёнными варками
    while (pinned.some(p => cursor < p.endHour && cursor + (b.brewHours||0) > p.startHour)) {
      const blocking = pinned.find(p => cursor < p.endHour && cursor + (b.brewHours||0) > p.startHour);
      cursor = blocking.endHour;
    }
    const startHour = cursor;
    const endHour = cursor + (b.brewHours || 0);
    cursor = endHour;
    result.push({ batch: b, startHour, endHour });
  });

  return result.sort((a,b) => a.startHour - b.startHour);
}

function checkConflict(reactor, date, hours, excludeBatchId) {
  const load = getReactorDayLoad(reactor, date, excludeBatchId);
  const total = load + (hours || 0);
  if (total > state.workdayHours) {
    return { conflict: true, load, total, free: Math.max(0, state.workdayHours - load) };
  }
  return { conflict: false, load, total, free: state.workdayHours - total };
}

// Проверка пересечения конкретного временного интервала с уже стоящими в этом
// реакторе/дне варками — используется при перетаскивании на конкретный час.
function checkTimeSlotConflict(reactor, date, startHour, hours, excludeBatchId) {
  const endHour = startHour + hours;
  if (startHour < WORKDAY_START_HOUR) return { conflict: true, reason: `Раньше начала рабочего дня (${WORKDAY_START_HOUR}:00)` };
  const sched = computeReactorSchedule(reactor, date).filter(s => s.batch.id !== excludeBatchId);
  const overlapping = sched.find(s => startHour < s.endHour && endHour > s.startHour);
  if (overlapping) {
    return { conflict: true, reason: `Пересекается с «${overlapping.batch.name}» (${overlapping.batch.id})`, overlapping };
  }
  if (endHour - WORKDAY_START_HOUR > state.workdayHours) {
    return { conflict: true, reason: `Выходит за пределы рабочего дня реактора (${state.workdayHours}ч)` };
  }
  return { conflict: false };
}

// Автовыбор реактора: наименее загруженный на дату, с учётом часов уже распределённых
// в текущем проходе генерации (runningLoads), чтобы несколько варок в одном вызове
// не попали все в один и тот же "свободный" реактор.
function autoAssignReactor(date, hours, runningLoads) {
  let best = null, bestLoad = Infinity, bestFits = false;
  state.reactors.forEach(r => {
    const baseLoad = getReactorDayLoad(r, date, null);
    const extra = (runningLoads && runningLoads[r]) ? runningLoads[r] : 0;
    const load = baseLoad + extra;
    const fits = (load + hours) <= state.workdayHours;
    // приоритет: сначала те, что физически вмещают варку; среди них — наименее загруженный
    if (fits && !bestFits) { best = r; bestLoad = load; bestFits = true; }
    else if (fits === bestFits && load < bestLoad) { best = r; bestLoad = load; bestFits = fits; }
  });
  if (!best) best = state.reactors[0]; // если совсем нет места — всё равно назначаем наименее загруженный, конфликт покажем отдельно
  if (runningLoads) runningLoads[best] = (runningLoads[best] || 0) + hours;
  return best;
}

;

// ════════════════════════════════════════════════════════════════════════════
// API CONFIG (миграция с Firebase Firestore на собственный REST API + MySQL, 2026-07-11)
// Бэкенд: api/*.php на этом же поддомене (manufacture.varka.kz), см. api/storage.php.
// ════════════════════════════════════════════════════════════════════════════
const API_BASE = 'api';

// Зависший fetch (сеть стучится, но не отвечает и не рвётся) без таймаута висит
// бесконечно — при первой загрузке это держит экран "Подключение..." вечно, т.к.
// initFirebase/loadState/trySso в init-IIFE никогда не дойдут до скрытия loading-screen.
// Таймаут гарантирует, что await fetch когда-нибудь завершится (ошибкой) и код
// пойдёт по уже существующей ветке catch → баннер "Сервер недоступен".
async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
  } finally {
    clearTimeout(t);
  }
}

let authToken = null;      // Bearer-токен серверной сессии (выдаёт api/auth)
// db оставлен как флаг «серверное хранилище доступно» — весь остальной код
// проверяет if (db) так же, как раньше проверял наличие Firestore.
// Стартует optimistically true (не null): loadState() и initFirebase() теперь
// идут параллельно при старте (см. init-IIFE), поэтому loadState() не может
// ждать подтверждения от initFirebase() перед первой попыткой — она и так
// полностью защищена try/catch. initFirebase() скорректирует db на null,
// если пинг реально покажет, что сервер недоступен.
let db = true;
let _fbReady = false;      // сервер доступен (имя сохранено, чтобы не трогать проверки по коду)
let _snapshotIgnoreUntil = 0;
let _applyingRemoteState = false; // true, пока применяем ВХОДЯЩЕЕ обновление (storage другой вкладки / фоновый опрос) — saveState не пишет обратно, иначе вкладки зацикливают друг друга
let _stateLoadedFromFirestore = false; // state загружен с сервера (имя историческое)
let _firebaseError = false;            // ошибка связи с сервером (имя историческое)
// Версия состояния на сервере, которую мы СЕЙЧАС считаем актуальной. Любая запись идёт
// с baseRev: если на сервере уже более новая версия (чужое устройство успело
// записать) — сервер отвечает 409, мы НЕ затираем её своим устаревшим состоянием,
// а принимаем свежее. Это защита от массового отката данных «старым» табом/устройством.
let _baseRev = 0;

// Обёртка над fetch для защищённых эндпоинтов: подставляет токен, при 401
// (сессия истекла/отозвана на сервере) — разлогинивает и показывает экран входа.
async function apiFetch(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetchWithTimeout(API_BASE + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { handleAuthExpired(); throw new Error('unauthorized'); }
  return res;
}

function handleAuthExpired() {
  authToken = null;
  currentUser = null;
  try { sessionStorage.removeItem('varka_session'); } catch(e) {}
  const shell = document.getElementById('app-shell');
  if (shell) shell.style.display = 'none';
  // Единый вход платформы (решение владельца 2026-07-21): своей формы входа у
  // Manufacture больше нет — протухшая/отозванная сессия уводит на портал;
  // при живом portal_token портал тихо переSSOшит обратно при следующем клике.
  window.location.replace('https://varka.kz/');
}

// ── pmStage: ЛОКАЛЬНЫЙ UI-выбор карточки-стадии в «Управлении производством» ──
// Намеренно НЕ в state и НЕ в Firestore: это выбор конкретного устройства,
// не должен синхронизироваться между пользователями через onSnapshot.
let _pmStage = sessionStorage.getItem('pmStage') || '';
function getPmStage() { return _pmStage; }
function setPmStage(stage) {
  // toggle: повторный клик по активной карточке снимает фильтр
  _pmStage = (_pmStage === stage) ? '' : stage;
  try { sessionStorage.setItem('pmStage', _pmStage); } catch(e) {}
  // НЕ перестраиваем всю панель карточек (иначе кнопка удаляется из DOM прямо
  // во время своего же клика → гонка, выбор срабатывает «через раз»).
  // Достаточно переключить класс active на существующих кнопках и перерисовать список.
  document.querySelectorAll('#pm-stage-tabs .reactor-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.stage === _pmStage && _pmStage !== '');
  });
  renderPmContent();
}
function clearPmStage() {
  _pmStage = '';
  try { sessionStorage.setItem('pmStage', ''); } catch(e) {}
}

// ════════════════════════════════════════════════════════════════════════════
// MASTER RENDER
// ════════════════════════════════════════════════════════════════════════════
function render() {
  if (!currentUser) return;
  // Каждый раздел рисуется изолированно: ошибка в одном (например, в алармах) НЕ должна
  // прерывать перерисовку остальных. Иначе падение раннего шага (renderAlarms) оставляло
  // бы «Управление производством» неперерисованным — назначенная варка визуально не
  // уходила в «Назначена». Ошибку логируем в консоль и продолжаем рендер.
  const steps = [
    ['syncRequestStatuses', syncRequestStatuses],
    ['renderAlarms', renderAlarms],
    ['renderDashboard', renderDashboard],
    ['renderProductionManagement', renderProductionManagement],
    ['renderRequests', renderRequests],
    ['renderWarshchikBatches', renderWarshchikBatches],
    ['renderIntake', renderIntake],
    ['renderCalendar', renderCalendar],
    ['renderReports', renderReports],
    ['renderJournal', renderJournal],
    ['renderRecipes', renderRecipes],
    ['renderAdmin', renderAdmin],
    ['updateBadge', updateBadge],
    ['populateSelects', populateSelects],
  ];
  steps.forEach(([name, fn]) => {
    try { fn(); } catch (e) { console.error('[render] ошибка в ' + name + ':', e); }
  });
  saveState();
}

function updateBadge() {
  const badge = document.getElementById('active-badge');
  if (currentUser.roleId === 'warshchik') {
    const n = state.batches.filter(b => b.status==='active'||b.status==='planned').length;
    badge.style.display = n ? 'inline-block' : 'none';
    badge.textContent = n;
  } else {
    // раздел "Заявки" убран из навигации — счётчик новых заявок больше не нужен
    badge.style.display = 'none';
  }
}

function populateSelects() {
  // reactor selects
  ['f-reactor','req-reactor'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = state.reactors.map(r => `<option value="${r}">${r}</option>`).join('');
  });
  // sku select (direct batch modal)
  const skuSel = document.getElementById('f-sku');
  if (skuSel) {
    const cur = skuSel.value;
    skuSel.innerHTML = '<option value="">— выберите продукт —</option>' +
      state.recipes.map(r => `<option value="${r.sku}" ${r.sku===cur?'selected':''}>${r.name}</option>`).join('');
  }
  // client select (requests modal)
  const clientSel = document.getElementById('req-client');
  if (clientSel) {
    const cur = clientSel.value;
    clientSel.innerHTML = '<option value="">— выберите клиента —</option>' +
      state.clients.map(c => `<option value="${c}" ${c===cur?'selected':''}>${c}</option>`).join('');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — с навигацией по дате
// ════════════════════════════════════════════════════════════════════════════
// Универсальная функция открытия date picker с защитой от зацикливания
const _pickerCooldowns = {};
function openDatePickerFor(id) {
  if (_pickerCooldowns[id]) return;
  _pickerCooldowns[id] = true;
  setTimeout(() => { _pickerCooldowns[id] = false; }, 800);
  const p = document.getElementById(id);
  if (p) try { p.showPicker(); } catch(e) {}
}

// Хелпер: обновить пилюлю даты и кнопку Сегодня
function updateDateNavUI(humanId, todayBtnId, dateStr) {
  const humanEl = document.getElementById(humanId);
  if (humanEl && dateStr) {
    const d = new Date(dateStr);
    humanEl.textContent = d.getDate() + ' ' + ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][d.getMonth()] + ' ' + d.getFullYear();
  }
  const btn = document.getElementById(todayBtnId);
  if (btn) {
    const isToday = dateStr === fmtDate(new Date());
    btn.classList.toggle('btn-primary', isToday);
    btn.classList.toggle('btn-ghost', !isToday);
  }
}

function dashOpenDatePicker() { openDatePickerFor('dash-date-picker'); }

// Горизонт дашборда → окно дат [start,end] (ISO) + человекочитаемая подпись.
// Якорь — state.dashDate. День: [d,d]; Неделя: Пн–Вс; Месяц: 1-е…послед. число.
const DASH_MON_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DASH_MON_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DASH_MON_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
// Пикер периода: пресет (сегодня/7д/30д/90д) или произвольный диапазон. Якорь state.dashDate = конец окна.
const DASH_PRESET_LEN = { today: 1, '7d': 7, '30d': 30, '90d': 90 };
function dashRange() {
  const today = fmtDate(new Date());
  const preset = state.dashPreset || 'today';
  const end = state.dashDate || today;
  let start;
  if (preset === 'custom') start = state.dashStart || end;
  else start = fmtDate(addDays(new Date(end), -((DASH_PRESET_LEN[preset] || 1) - 1)));
  const horizon = (start === end) ? 'day' : 'range';
  const a = new Date(start), b = new Date(end);
  let label;
  if (preset === 'today' && end === today) label = 'Сегодня';
  else if (start === end) label = b.getDate() + ' ' + DASH_MON_SHORT[b.getMonth()] + ' ' + b.getFullYear();
  else label = a.getDate() + ' ' + DASH_MON_SHORT[a.getMonth()] + ' – ' + b.getDate() + ' ' + DASH_MON_SHORT[b.getMonth()] + ' ' + b.getFullYear();
  return { start, end, horizon, label };
}

function dashShiftDay(delta) {
  const r = dashRange();
  const len = Math.round((new Date(r.end) - new Date(r.start)) / 86400000) + 1;
  const sh = delta * len;
  state.dashDate = fmtDate(addDays(new Date(r.end), sh));
  if ((state.dashPreset || 'today') === 'custom') state.dashStart = fmtDate(addDays(new Date(r.start), sh));
  saveState();
  renderDashboard();
}

function dashClosePicker() {
  const pop = document.getElementById('dash-pop'), dp = document.getElementById('dash-datepick');
  if (pop) pop.classList.add('hidden');
  if (dp) dp.classList.remove('open');
}
function dashTogglePicker(e) {
  if (e) e.stopPropagation();
  const pop = document.getElementById('dash-pop'), dp = document.getElementById('dash-datepick');
  if (!pop) return;
  const willOpen = pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !willOpen);
  if (dp) dp.classList.toggle('open', willOpen);
  if (willOpen) setTimeout(function () {
    document.addEventListener('click', function h(ev) {
      if (dp && dp.contains(ev.target)) return;
      dashClosePicker();
      document.removeEventListener('click', h);
    });
  }, 0);
}
function setDashPreset(p) {
  state.dashPreset = p;
  state.dashDate = fmtDate(new Date()); // пресеты — относительно сегодня
  saveState();
  dashClosePicker();
  renderDashboard();
}
function dashApplyCustom() {
  const cf = document.getElementById('dash-cust-from'), ct = document.getElementById('dash-cust-to');
  if (!cf || !ct || !cf.value || !ct.value) return;
  let s = cf.value, e = ct.value;
  if (s > e) { const t = s; s = e; e = t; }
  state.dashPreset = 'custom';
  state.dashStart = s;
  state.dashDate = e;
  saveState();
  dashClosePicker();
  renderDashboard();
}
function dashGoToDate(iso) {
  if (!iso) return;
  state.dashDate = iso;
  saveState();
  renderDashboard();
}
function dashGoToday() {
  state.dashDate = fmtDate(new Date());
  saveState();
  renderDashboard();
}
function setDashHorizon(h, btn) {
  state.dashHorizon = h;
  document.querySelectorAll('#page-dashboard .filter-btn').forEach(b => b.classList.toggle('active', b === btn));
  saveState();
  renderDashboard();
}

// Русское склонение существительного по числу: pluralRu(2,'варка','варки','варок')
function pluralRu(n, one, few, many) {
  const m = Math.abs(n) % 100, d = m % 10;
  if (m >= 11 && m <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

// ════════════════════════════════════════════════════════════════════════════
// ПАНЕЛЬ АЛАРМОВ — сводка тревожных сигналов по всему производству
// ════════════════════════════════════════════════════════════════════════════
const ALARM_DEVIATION_THRESHOLD_PCT = 10;  // отклонение план/факт больше N% — тревога
const ALARM_MISSING_FACT_HOURS = 12;       // варка завершена, но факт сырья не введён дольше N часов
const ALARM_START_POURING_MINUTES = 30;    // сварено, линия назначена и передана в розлив, но не начато физически дольше N минут
const ALARM_ENTER_QTY_MINUTES = 60;        // розлив завершён, но количество не введено дольше N минут

const ALARM_GROUPS = [
  ['overdue', 'Просрочки'],
  ['pouring', 'Требует действия по розливу'],
  ['deviation', 'Отклонения план-факт'],
  ['missing_fact', 'Не введён факт сырья'],
  ['other', 'Прочее'],
];

function computeAlarms() {
  const alarms = [];
  const today = fmtDate(new Date());
  const now = new Date();
  const liveBatches = state.batches.filter(b => b.status !== 'deleted' && b.status !== 'cancelled');

  // 1. Просроченные варки — назначены на прошедшую дату, но не сварены. Ведём
  // динамически туда, где партия сейчас реально находится в «Управлении производством»
  const overdue = liveBatches.filter(b => (b.status === 'planned' || b.status === 'active') && b.brewDate < today);
  overdue.forEach(b => {
    const daysLate = Math.round((new Date(today) - new Date(b.brewDate)) / 86400000);
    alarms.push({
      key: `overdue_${b.id}`, batchId: b.id, batchName: b.name,
      severity: 'critical', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6M22 6l-3-3"/></svg>', group: 'overdue',
      text: `<strong>${b.name}</strong> (${b.id}) просрочена на ${daysLate} дн. — назначена на ${fmtDateHuman(b.brewDate)}`,
      plainText: `Просрочка: ${b.name} (${b.id}) просрочена на ${daysLate} дн. — назначена на ${fmtDateHuman(b.brewDate)}`,
      page: 'production', pmStage: getBatchStage(b)
    });
  });

  // 1b. Варка идёт дольше запланированного времени — активная варка, у которой реальное
  // время с момента старта уже превысило плановое brewHours. Критично: процесс «висит».
  liveBatches.filter(b => b.status === 'active' && b.brewStartedAt).forEach(b => {
    const elapsedMs = now - new Date(b.brewStartedAt);
    const plannedMs = (b.brewHours || 2) * 3600000;
    if (elapsedMs > plannedMs) {
      const fmtDur = ms => { const h = Math.floor(ms/3600000), m = Math.round((ms%3600000)/60000); return h > 0 ? `${h}ч ${m}м` : `${m}м`; };
      const elapsedStr = fmtDur(elapsedMs);
      const overStr = fmtDur(elapsedMs - plannedMs);
      alarms.push({
        key: `brew_overrun_${b.id}`, batchId: b.id, batchName: b.name,
        severity: 'critical', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6M22 6l-3-3"/></svg>', group: 'overdue',
        text: `<strong>${b.name}</strong> (${b.id}) варится ${elapsedStr} — дольше плана на ${overStr} (план ${b.brewHours||2}ч)`,
        plainText: `Варка дольше плана: ${b.name} (${b.id}) варится ${elapsedStr}, превышение на ${overStr} (план ${b.brewHours||2}ч)`,
        page: 'production', pmStage: getBatchStage(b)
      });
    }
  });

  // 2. Перегруз реактора на сегодня/завтра — ведёт в Календарь, как и раньше (отдельная тема, не про конкретную партию)
  [today, fmtDate(addDays(new Date(today), 1))].forEach(date => {
    state.reactors.forEach(r => {
      const load = getReactorDayLoad(r, date, null);
      if (load > state.workdayHours) {
        const label = date === today ? 'сегодня' : 'завтра';
        alarms.push({
          key: `load_${r}_${date}`, batchId: null, batchName: null,
          severity: 'warning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', group: 'other',
          text: `Реактор <strong>${r}</strong> перегружен ${label}: назначено ${load}ч из ${state.workdayHours}ч`,
          plainText: `Перегруз реактора: ${r} перегружен ${label}: назначено ${load}ч из ${state.workdayHours}ч`,
          page: 'calendar'
        });
      }
    });
  });

  // 3. Группа «Требует действия по розливу» — единая цепочка проверок на партию:
  // нет линии → ждёт розлива (инфо) → 30 мин без старта (важно) → 60 мин без введённого кол-ва (важно).
  // Старое правило «ждёт приёмки выхода 2 дня» удалено целиком, заменено этим.
  liveBatches.filter(b => b.status === 'done').forEach(b => {
    if (!b.pouringLine) {
      alarms.push({
        key: `no_line_${b.id}`, batchId: b.id, batchName: b.name,
        severity: 'warning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>', group: 'pouring',
        text: `<strong>${b.name}</strong> (${b.id}) сварено — нужно назначить линию розлива`,
        plainText: `${b.name} (${b.id}) сварено — нужно назначить линию розлива`,
        page: 'production', pmStage: 'brewed'
      });
      return;
    }
    if (!b.sentToPouring) return;
    if (!b.pouringStartedAt) {
      const brewEnd = b.brewEndedAt ? new Date(b.brewEndedAt) : new Date(b.brewDate + 'T23:59:59');
      const minutesSince = (now - brewEnd) / 60000;
      if (minutesSince >= ALARM_START_POURING_MINUTES) {
        alarms.push({
          key: `no_start_${b.id}`, batchId: b.id, batchName: b.name,
          severity: 'warning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', group: 'pouring',
          text: `<strong>${b.name}</strong> (${b.id}): нужно начать розлив (линия «${b.pouringLine}»)`,
          plainText: `${b.name} (${b.id}): нужно начать розлив, линия «${b.pouringLine}»`,
          page: 'production', pmStage: 'pouring'
        });
      } else {
        alarms.push({
          key: `wait_pour_${b.id}`, batchId: b.id, batchName: b.name,
          severity: 'info', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', group: 'pouring',
          text: `<strong>${b.name}</strong> (${b.id}) ждёт розлива на «${b.pouringLine}»`,
          plainText: `${b.name} (${b.id}) ждёт розлива на «${b.pouringLine}»`,
          page: 'production', pmStage: 'pouring'
        });
      }
      return;
    }
    if (b.pouringEndedAt && (b.factQty === null || b.factQty === undefined)) {
      const minutesSince = (now - new Date(b.pouringEndedAt)) / 60000;
      if (minutesSince >= ALARM_ENTER_QTY_MINUTES) {
        alarms.push({
          key: `no_qty_${b.id}`, batchId: b.id, batchName: b.name,
          severity: 'warning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>', group: 'pouring',
          text: `<strong>${b.name}</strong> (${b.id}): введите фактическое количество`,
          plainText: `${b.name} (${b.id}): введите фактическое количество после розлива`,
          page: 'production', pmStage: 'poured'
        });
      }
    }
  });

  // 4. Сильное отклонение план/факт по недавним завершённым партиям (последние 7 дней) —
  // остаётся видна главному оператору в «Управлении производством», на вкладке «Готово»
  const recentDone = liveBatches.filter(b => b.status === 'done' && b.factQty !== null && b.factQty !== undefined && b.planQty &&
    (new Date(today) - new Date(b.brewDate)) / 86400000 <= 7);
  recentDone.forEach(b => {
    const devPct = Math.abs((b.factQty - b.planQty) / b.planQty * 100);
    if (devPct >= ALARM_DEVIATION_THRESHOLD_PCT) {
      const dir = b.factQty < b.planQty ? 'недовыпуск' : 'перевыпуск';
      alarms.push({
        key: `deviation_${b.id}`, batchId: b.id, batchName: b.name,
        severity: 'warning', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>', group: 'deviation',
        text: `<strong>${b.name}</strong> (${b.id}): ${dir} ${devPct.toFixed(1)}% от плана (план ${b.planQty}, факт ${b.factQty})`,
        plainText: `${b.name} (${b.id}): ${dir} ${devPct.toFixed(1)}% от плана (план ${b.planQty}, факт ${b.factQty})`,
        page: 'production', pmStage: 'finished'
      });
    }
  });

  // 5. Варка завершена, но факт по сырью не введён дольше N часов
  liveBatches.filter(b => b.status === 'done').forEach(b => {
    const totalIngredients = (b.ingredients || []).length;
    const filledIngredients = b.factIngredients ? Object.keys(b.factIngredients).length : 0;
    if (totalIngredients > 0 && filledIngredients < totalIngredients) {
      // оцениваем "возраст" по дате варки (нет точного timestamp завершения, используем конец дня варки как ориентир)
      const brewEnd = new Date(b.brewDate + 'T23:59:59');
      const hoursSince = (now - brewEnd) / 3600000;
      if (hoursSince >= ALARM_MISSING_FACT_HOURS) {
        alarms.push({
          key: `missing_fact_${b.id}`, batchId: b.id, batchName: b.name,
          severity: 'info', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>', group: 'missing_fact',
          text: `<strong>${b.name}</strong> (${b.id}): факт по сырью не введён полностью (${filledIngredients}/${totalIngredients} компонентов)`,
          plainText: `${b.name} (${b.id}): факт по сырью не введён полностью (${filledIngredients}/${totalIngredients} компонентов)`,
          page: 'warshchik'
        });
      }
    }
  });

  return alarms;
}

function renderAlarms() {
  const alarms = computeAlarms();

  // Логируем новые алармы в журнал событий (без дублей)
  if (!state.loggedAlarmKeys) state.loggedAlarmKeys = {};
  const sevLabel = { critical: '[КРИТИЧНО]', warning: '[ВАЖНО]', info: '[ИНФО]' };
  let newLogged = false;
  // Очищаем ключи аларм которых больше нет (чтобы при повторном появлении залогировать снова)
  const currentKeys = new Set(alarms.map(a => a.key).filter(Boolean));
  Object.keys(state.loggedAlarmKeys).forEach(k => { if (!currentKeys.has(k)) delete state.loggedAlarmKeys[k]; });
  alarms.forEach(a => {
    if (!a.key || state.loggedAlarmKeys[a.key]) return;
    state.loggedAlarmKeys[a.key] = new Date().toISOString();
    if (!state.systemEvents) state.systemEvents = [];
    state.systemEvents.unshift({
      id: 'ALR-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
      timestamp: new Date().toISOString(),
      severity: a.severity || 'info',
      batchId: a.batchId || null,
      batchName: a.batchName || null,
      text: `${sevLabel[a.severity] || '[АЛАРМ]'} ${a.plainText || a.text.replace(/<[^>]+>/g,'')}`,
      source: 'Алармы',
      page: a.page || null,
      pmStage: a.pmStage || null
    });
    if (state.systemEvents.length > 500) state.systemEvents.length = 500;
    newLogged = true;
  });
  if (newLogged) saveState();

  // Обновляем бегущую строку
  renderAlarmTicker(alarms);

  const sevOrder = { critical: 0, warning: 1, info: 2 };
  alarms.sort((a,b) => sevOrder[a.severity] - sevOrder[b.severity]);

  const critCount = alarms.filter(a => a.severity === 'critical').length;
  const warnCount = alarms.filter(a => a.severity === 'warning').length;
  const infoCount = alarms.filter(a => a.severity === 'info').length;

  // Пилюли алармов — статические span-ы в HTML, просто обновляем текст и видимость
  const pc = document.getElementById('jpill-critical');
  const pw = document.getElementById('jpill-warning');
  const pi = document.getElementById('jpill-info');
  if (pc) { pc.textContent = critCount + ' критич.'; pc.style.display = critCount ? '' : 'none'; }
  if (pw) { pw.textContent = warnCount + ' важных';  pw.style.display = warnCount ? '' : 'none'; }
  if (pi) { pi.textContent = infoCount + ' информац.'; pi.style.display = infoCount ? '' : 'none'; }

  renderSystemEvents();
}

let _tickerAnim = null;
let _tickerRunId = 0; // токен поколения тикера: живёт только последний запуск; осиротевшие rAF-циклы (от частых render) сами останавливаются по несовпадению
let _tickerPauseUntil = 0;
let _tickerPos = 0;

function renderAlarmTicker(alarms) {
  const ticker  = document.getElementById('alarm-ticker');
  const inner   = document.getElementById('alarm-ticker-inner');
  const content = document.getElementById('alarm-ticker-content');
  if (!ticker || !inner || !content) return;

  // Новое поколение тикера. Любой ранее запущенный rAF-цикл step увидит несовпадение
  // myRun !== _tickerRunId и сам остановится — это исключает накопление осиротевших циклов
  // (главная причина нарастающего «зависания» при частых render).
  const myRun = ++_tickerRunId;

  function adjustSidebar(tickerVisible) {
    const tickerH = tickerVisible ? 28 : 0;
    const offset = 64 + tickerH;
    const sb = document.querySelector('.sidebar');
    if (sb) { sb.style.top = offset + 'px'; sb.style.height = 'calc(100vh - ' + offset + 'px)'; }
    const main = document.querySelector('.app-main');
    if (main) { main.style.height = 'calc(100vh - ' + offset + 'px)'; }
    const layout = document.querySelector('.app-layout');
    if (layout) { layout.style.minHeight = 'calc(100vh - ' + offset + 'px)'; }
  }

  // Терминал оператора варки — без бегущей строки, она мешает рабочему экрану.
  if (isBrewOperatorRole()) {
    ticker.style.display = 'none';
    ticker.classList.remove('has-critical');
    if (_tickerAnim) { cancelAnimationFrame(_tickerAnim); _tickerAnim = null; }
    adjustSidebar(false);
    return;
  }

  if (!alarms.length) {
    ticker.style.display = 'none';
    ticker.classList.remove('has-critical');
    if (_tickerAnim) { cancelAnimationFrame(_tickerAnim); _tickerAnim = null; }
    adjustSidebar(false);
    return;
  }

  ticker.style.display = 'block';
  ticker.style.background = '#0f172a';
  adjustSidebar(true);

  const sevIcon  = { critical: '🔴', warning: '⚠️', info: 'ℹ️' };
  const sevClass = { critical: 'ticker-item-critical', warning: 'ticker-item-warning', info: 'ticker-item-info' };

  // Помечаем критичные элементы атрибутом для определения позиции паузы
  const itemsHtml = alarms.map((a, i) =>
    `<span class="ticker-item ${sevClass[a.severity] || ''}" ${a.severity === 'critical' ? `data-critical="1"` : ''} data-idx="${i}">${sevIcon[a.severity] || '•'} ${(a.plainText || a.text.replace(/<[^>]+>/g,'')).toUpperCase()}</span><span class="ticker-sep">│</span>`
  ).join('');

  // Дублируем для бесшовного зацикливания
  content.innerHTML = itemsHtml + itemsHtml;

  // Сбрасываем старую анимацию
  if (_tickerAnim) { cancelAnimationFrame(_tickerAnim); _tickerAnim = null; }

  // Ждём рендер DOM чтобы измерить позиции
  requestAnimationFrame(() => {
    if (myRun !== _tickerRunId) return; // устарел — запущен более новый тикер
    const totalW = content.scrollWidth / 2;
    if (totalW <= 0) return;

    // Собираем позиции критичных элементов (в первом наборе)
    const criticalStops = [];
    content.querySelectorAll('[data-critical="1"]').forEach(el => {
      if (el.offsetLeft < totalW) criticalStops.push(el.offsetLeft);
    });

    const speed = 0.7; // px per frame
    const PAUSE_MS = 5000;

    function step(ts) {
      if (myRun !== _tickerRunId) return; // осиротевший цикл прошлого поколения — стоп
      // Если сейчас пауза — ждём
      if (ts < _tickerPauseUntil) {
        // Во время паузы пульсируем фон красным
        const phase = Math.sin((ts / 400) * Math.PI);
        const r = Math.round(127 + phase * 79);
        ticker.style.background = `rgb(${r},20,20)`;
        ticker.classList.add('has-critical');
        _tickerAnim = requestAnimationFrame(step);
        return;
      }

      // Убираем эффект после паузы
      ticker.classList.remove('has-critical');
      ticker.style.background = '#0f172a';

      // Проверяем — проходим ли через критичный элемент (с допуском 1px)
      for (const stopX of criticalStops) {
        const normalized = stopX % totalW;
        if (_tickerPos < normalized && _tickerPos + speed >= normalized) {
          _tickerPos = normalized;
          inner.style.transform = `translateX(-${_tickerPos}px)`;
          _tickerPauseUntil = ts + PAUSE_MS;
          _tickerAnim = requestAnimationFrame(step);
          return;
        }
      }

      _tickerPos += speed;
      if (_tickerPos >= totalW) _tickerPos -= totalW;
      inner.style.transform = `translateX(-${_tickerPos}px)`;
      _tickerAnim = requestAnimationFrame(step);
    }

    _tickerAnim = requestAnimationFrame(step);
  });
}

function toggleAlarmsPanel() {
  state.alarmsCollapsed = !state.alarmsCollapsed;
  saveState();
  renderAlarms();
}

function goToAlarmPage(pageId, pmStage) {
  const tabBtn = document.querySelector(`.nav-tab[data-page="${pageId}"]`);
  if (tabBtn) {
    showPage(pageId, tabBtn);
    if (pageId === 'production' && pmStage) {
      _pmStage = pmStage;
      try { sessionStorage.setItem('pmStage', _pmStage); } catch(e) {}
      renderProductionManagement();
    }
    return;
  }
  // у текущей роли нет доступа к этой вкладке напрямую (например, "warshchik" видна только этой роли) —
  // в таком случае просто ничего не делаем, клик по тревоге безопасен
}

function renderDashboard() {
  const el = document.getElementById('reactor-dashboard');
  const today = fmtDate(new Date());
  const viewDate = state.dashDate || today;
  const isToday = viewDate === today;

  const range = dashRange();
  const rangeLbl = document.getElementById('dash-range-label');
  if (rangeLbl) rangeLbl.textContent = range.label;
  const dpPreset = state.dashPreset || 'today';
  document.querySelectorAll('#page-dashboard .dash-preset').forEach(b => b.classList.toggle('on', b.dataset.p === dpPreset));
  const cf = document.getElementById('dash-cust-from'), ct = document.getElementById('dash-cust-to');
  if (cf) cf.value = range.start;
  if (ct) ct.value = range.end;
  const rdLabel = document.getElementById('dash-reactor-date-label');
  if (rdLabel) rdLabel.textContent = fmtDateHuman(viewDate);
  const totalLbl = document.getElementById('s-total-lbl');
  if (totalLbl) totalLbl.textContent = isToday ? 'Варок сегодня' : 'Варок в этот день';

  const dayBatches = state.batches.filter(b => b.brewDate === viewDate && b.status !== 'deleted');
  const _setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  _setTxt('s-total', dayBatches.length);
  _setTxt('s-active', dayBatches.filter(b=>b.status==='active').length);
  _setTxt('s-done', dayBatches.filter(b=>b.status==='done').length);
  _setTxt('s-requests', isToday ? state.requests.filter(r=>r.status==='new').length : state.requests.filter(r=>r.brewDate===viewDate && r.status==='new').length);

  if (el && !state.reactors.length) { el.innerHTML = ''; }
  else if (el) {
    el.innerHTML = state.reactors.map(r => {
      const rb = dayBatches.filter(b => b.reactor === r).sort((a,b) => a.priority - b.priority);
      const rc = reactorColor(r);
      const active = rb.find(b=>b.status==='active');
      const loadHours = rb.filter(b=>b.status!=='cancelled').reduce((s,b)=>s+(b.brewHours||0),0);
      const loadPct = Math.min(100, Math.round(loadHours / state.workdayHours * 100));
      return `<div class="card">
        <div class="card-header">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="reactor-badge rc-${rc}">${r}</div>
            <div>
              <div style="font-size:15px; font-weight:700;">${r}</div>
              <div style="font-size:12px; color:var(--text2);">${rb.length} варок · загрузка ${loadHours}/${state.workdayHours} ч</div>
            </div>
          </div>
          ${active ? `<div style="font-size:12px; color:var(--accent); font-weight:600;">${active.name.substring(0,22)}</div>` : ''}
        </div>
        <div class="cal-load-bar" style="margin-bottom:8px;">
          <div class="cal-load-fill" style="width:${loadPct}%; background:${loadPct>=100?'var(--danger)':loadPct>=70?'var(--warn)':'var(--accent2)'};"></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${rb.length ? rb.map((b,i) => `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 8px; background:var(--surface2); border-radius:8px;">
              <div style="font-size:11px; font-weight:800; color:var(--text3); width:16px;">${i+1}</div>
              <div style="font-size:13px; font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${b.name}</div>
              <div style="font-size:11px; font-weight:700;" class="s-${b.status}">${statusLabel(b.status)}</div>
              <div style="font-size:11px; color:var(--text2);">${b.brewHours}ч</div>
            </div>
          `).join('') : `<div style="font-size:13px; color:var(--text3); text-align:center; padding:12px;">Нет варок</div>`}
        </div>
      </div>`;
    }).join('');
  }

  renderBiAnalytics();
}

// ════════════════════════════════════════════════════════════════════════════
// BI АНАЛИТИКА
// ════════════════════════════════════════════════════════════════════════════

// Уровень 1 «Пульс дня» — 5 фактических показателей по окну горизонта (День/Неделя/Месяц).
// Логика сварено/выпущено: варка проходит стадии … brewed → pouring → poured → finished.
//   Сварено   = объём варок, у которых варка ЗАВЕРШЕНА (стадия brewed и дальше) — продукт физически сварен.
//   Выпущено  = штуки/объём варок, где розлив закрыт (есть factQty).
//   Ожидает розлива = сварено, но ещё не выпущено (brewed/pouring/poured) — объясняет разницу первых двух.
// Объём варки = b.volume; если не заполнен (историч. данные) — оцениваем planQty×тара из рецепта.
function renderPulseDay(range) {
  const el = document.getElementById('bi-pulse');
  if (!el) return;
  range = range || dashRange();
  const isDay = range.horizon === 'day';
  const isToday = isDay && range.start === fmtDate(new Date());
  const recBySku = {}; (state.recipes || []).forEach(r => { if (r && r.sku) recBySku[r.sku] = r; });
  const taraOf = b => (b.tara != null ? b.tara : (recBySku[b.sku] ? recBySku[b.sku].tara : 0)) || 0;
  const volOf  = b => (b.volume != null && b.volume > 0) ? b.volume : (b.planQty || 0) * taraOf(b);
  const nf = n => Math.round(n || 0).toLocaleString('ru-RU');
  const tf = kg => ((kg || 0) / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

  const periodBatches = state.batches.filter(b => b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
  const totalCount = periodBatches.length;

  // Сварено — варка завершена (стадия brewed и позже); Ожидает розлива — сварено, но розлив ещё не закрыт.
  const brewedStages   = new Set(['brewed', 'pouring', 'poured', 'finished']);
  const awaitingStages = new Set(['brewed', 'pouring', 'poured']);
  const brewedB   = periodBatches.filter(b => brewedStages.has(getBatchStage(b)));
  const awaitingB = periodBatches.filter(b => awaitingStages.has(getBatchStage(b)) && b.factQty == null);
  const releasedB = periodBatches.filter(b => b.factQty != null); // розлив закрыт → выпущено

  const brewedKg   = brewedB.reduce((s,b) => s + volOf(b), 0);
  const awaitingKg = awaitingB.reduce((s,b) => s + volOf(b), 0);
  const releasedQty = releasedB.reduce((s,b) => s + (b.factQty || 0), 0);
  const releasedKg  = releasedB.reduce((s,b) => s + (b.factQty || 0) * taraOf(b), 0);

  // День-сегодня — live (варят/разливают сейчас); иначе — сколько реакторов задействовано за окно
  const liveReactors = isToday
    ? new Set(periodBatches.filter(b => { const st = getBatchStage(b); return st === 'brewing' || st === 'pouring'; }).map(b => b.reactor)).size
    : new Set(periodBatches.map(b => b.reactor).filter(Boolean)).size;

  const avgBrewKg = brewedB.length ? brewedKg / brewedB.length : 0;   // средняя варка (кг)
  const skuN = new Set(releasedB.map(b => b.sku || b.name).filter(Boolean)).size; // ассортимент выпуска
  const idleReactors = Math.max(0, state.reactors.length - liveReactors);
  const pluVar = n => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? 'варок' : (b === 1 ? 'варка' : (b >= 2 && b <= 4 ? 'варки' : 'варок')); };
  const SW = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ic = {
    brew: `<svg viewBox="0 0 24 24" ${SW}><ellipse cx="12" cy="4.5" rx="6.5" ry="2.3"/><path d="M5.5 4.5v15c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3v-15"/><path d="M4.6 9.5h14.8M4.6 14.5h14.8"/></svg>`,
    out:  `<svg viewBox="0 0 24 24" ${SW}><path d="M10 2h4v2.5l1.2 2.2a3 3 0 0 1 .8 2V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8.7a3 3 0 0 1 .8-2L10 4.5V2z"/><path d="M9 12h6"/></svg>`,
    vark: `<svg viewBox="0 0 24 24" ${SW}><path d="M9 3h6"/><path d="M10 3v6l-4.5 8.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3"/><path d="M8.5 15h7"/></svg>`,
    reac: `<svg viewBox="0 0 24 24" ${SW}><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`,
    wait: `<svg viewBox="0 0 24 24" ${SW}><path d="M6 3h12M6 21h12M8 3v3.5l4 5.5 4-5.5V3M8 21v-3.5l4-5.5 4 5.5V21"/></svg>`
  };
  const kt = (grad, lbl, icon, val, footL, footR) => `<div class="dash-kt" style="background:${grad}">
    <div class="dash-kt-top"><span class="dash-kt-lbl">${lbl}</span><span class="dash-kt-ic">${icon}</span></div>
    <div class="dash-kt-val">${val}</div>
    <div class="dash-kt-foot"><span>${footL}</span><b>${footR}</b></div>
  </div>`;

  el.innerHTML =
    kt('linear-gradient(135deg,#3b82f6,#1d4ed8)', 'Сварено', ic.brew, `${tf(brewedKg)}<small> т</small>`, 'средняя варка', brewedB.length ? `~${nf(avgBrewKg)} кг` : '—') +
    kt('linear-gradient(135deg,#10b981,#047857)', 'Выпущено', ic.out, `${nf(releasedQty)}<small> шт</small>`, 'ассортимент', `${skuN} SKU`) +
    kt('linear-gradient(135deg,#8b5cf6,#6d28d9)', 'Варок', ic.vark, `${totalCount}`, 'завершено', `${releasedB.length}`) +
    kt('linear-gradient(135deg,#06b6d4,#0e7490)', 'Реакторов', ic.reac, `${liveReactors}<small> / ${state.reactors.length}</small>`, 'свободно', `${idleReactors}`) +
    kt('linear-gradient(135deg,#f59e0b,#ea580c)', 'Ожидает розлива', ic.wait, `${tf(awaitingKg)}<small> т</small>`, 'ожидает', `${awaitingB.length} ${pluVar(awaitingB.length)}`);
}

// Деталь «Выпущено — по продуктам»: кольцо выпуска (шт) по SKU + бары по линиям розлива.
function renderDashReleased(range) {
  const el = document.getElementById('dash-released');
  if (!el) return;
  range = range || dashRange();
  const recBySku = {}; (state.recipes || []).forEach(r => { if (r && r.sku) recBySku[r.sku] = r; });
  const nf = n => Math.round(n || 0).toLocaleString('ru-RU');
  const pb = state.batches.filter(b => b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
  const releasedB = pb.filter(b => b.factQty != null);

  const bySku = {};
  releasedB.forEach(b => { const k = b.name || b.sku || '—'; (bySku[k] = bySku[k] || { name: k, qty: 0 }).qty += (b.factQty || 0); });
  let rows = Object.values(bySku).sort((a, b) => b.qty - a.qty);
  const totQty = rows.reduce((s, r) => s + r.qty, 0);
  if (rows.length > 5) { const top = rows.slice(0, 5); top.push({ name: 'Прочее', qty: rows.slice(5).reduce((s, r) => s + r.qty, 0) }); rows = top; }
  const cols = ['#10b981', '#22d3ee', '#a78bfa', '#f59e0b', '#ec4899', '#64748b'];
  const R = 46, C = 2 * Math.PI * R; let off = 0;
  const segs = rows.map((r, i) => { const len = totQty ? (r.qty / totQty) * C : 0; const s = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${cols[i % cols.length]}" stroke-width="16" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"></circle>`; off += len; return s; }).join('');
  const legend = rows.map((r, i) => { const pc = totQty ? Math.round(r.qty / totQty * 100) : 0; return `<div class="db-leg-i"><span class="db-dot" style="background:${cols[i % cols.length]}"></span><span class="nm" title="${r.name}">${r.name}</span><b>${nf(r.qty)}</b><span class="pc">${pc}%</span></div>`; }).join('');

  const poB = pb.filter(b => b.pouringLine && b.factQty != null);
  const lrows = (state.pouringLines || []).map(l => { const lb = poB.filter(b => b.pouringLine === l); return { l, qty: lb.reduce((s, b) => s + (b.factQty || 0), 0) }; }).sort((a, b) => b.qty - a.qty);
  const maxLine = Math.max(1, ...lrows.map(x => x.qty));
  const linesHtml = lrows.length ? `<div class="db-lines"><div class="db-lines-h">по линиям розлива</div>` + lrows.map(x => `<div class="db-lrow"><span class="nm" title="${x.l}">${x.l}</span><span class="tr"><i style="width:${Math.max(2, Math.round(x.qty / maxLine * 100))}%;background:linear-gradient(90deg,#059669,#34d399)"></i></span><b>${nf(x.qty)}</b></div>`).join('') + `</div>` : '';

  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v2.5l1.2 2.2a3 3 0 0 1 .8 2V19a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8.7a3 3 0 0 1 .8-2L10 4.5V2z"/><path d="M9 12h6"/></svg>`;
  const head = `<div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Выпущено — по продуктам</div><div class="db-sb">готовая продукция за период</div></div><span class="db-badge">${nf(totQty)} шт</span></div>`;
  const body = totQty <= 0
    ? `<div class="db-empty">Нет выпущенной продукции за период</div>`
    : `<div class="db-bd"><div class="db-donut-wrap"><svg class="db-donut" viewBox="0 0 120 120" width="120" height="120"><g transform="rotate(-90 60 60)">${segs}</g><text x="60" y="56" text-anchor="middle" class="db-dc-v">${nf(totQty)}</text><text x="60" y="73" text-anchor="middle" class="db-dc-k">шт</text></svg><div class="db-leg">${legend}</div></div>${linesHtml}</div>`;
  el.innerHTML = `<div class="db-card" style="--dbc:#10b981">${head}${body}</div>`;
}

// Деталь «Варки»: Сегодня → живой конвейер по стадиям; период (7/30/90д) → накопительно (всего/завершено/в работе) + по дням.
function renderDashVarki(range) {
  const el = document.getElementById('dash-varki');
  if (!el) return;
  range = range || dashRange();
  const isDay = range.horizon === 'day';
  const pb = state.batches.filter(b => b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6l-4.5 8.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3"/><path d="M8.5 15h7"/></svg>`;
  let body;
  if (isDay) {
    const bk = { q: 0, br: 0, bd: 0, po: 0, dn: 0 };
    pb.forEach(b => { const st = getBatchStage(b);
      if (st === 'queued' || st === 'assigned') bk.q++;
      else if (st === 'brewing') bk.br++;
      else if (st === 'brewed') bk.bd++;
      else if (st === 'pouring' || st === 'poured') bk.po++;
      else if (st === 'finished') bk.dn++; });
    const tot = pb.length || 1;
    const cells = [['В очереди', bk.q, '#64748b'], ['Варится', bk.br, '#3b82f6'], ['Сварено', bk.bd, '#8b5cf6'], ['На розливе', bk.po, '#f59e0b'], ['Готово', bk.dn, '#10b981']];
    const tiles = cells.map(c => `<div class="db-st" style="--sc:${c[2]}"><div class="n">${c[1]}</div><div class="l">${c[0]}</div></div>`).join('');
    const bar = cells.map(c => `<span style="width:${(c[1] / tot * 100).toFixed(1)}%;background:${c[2]}"></span>`).join('');
    body = `<div class="db-bd"><div class="db-st-tiles">${tiles}</div><div class="db-stacked">${bar}</div><div class="db-cap">Готово <b>${bk.dn} из ${pb.length}</b> · в работе ${pb.length - bk.dn}</div></div>`;
  } else {
    const done = pb.filter(b => b.factQty != null).length;
    const tot = pb.length, wip = tot - done;
    const dayMap = {}; pb.forEach(b => { dayMap[b.brewDate] = (dayMap[b.brewDate] || 0) + 1; });
    const days = []; let d = new Date(range.start); const end = new Date(range.end);
    while (d <= end) { const iso = fmtDate(d); days.push({ iso, n: dayMap[iso] || 0 }); d = addDays(d, 1); }
    const maxN = Math.max(1, ...days.map(x => x.n));
    const daysHtml = days.map(x => `<div class="db-day" title="${fmtDateHuman(x.iso)}: ${x.n}"><div class="db-day-bar" style="height:${x.n ? Math.max(8, Math.round(x.n / maxN * 100)) : 0}%"></div></div>`).join('');
    const tiles = [['Всего', tot, '#8b5cf6'], ['Завершено', done, '#10b981'], ['В работе', wip, '#f59e0b']].map(c => `<div class="db-st" style="--sc:${c[2]}"><div class="n">${c[1]}</div><div class="l">${c[0]}</div></div>`).join('');
    body = `<div class="db-bd"><div class="db-st-tiles">${tiles}</div><div class="db-days-h">варок по дням</div><div class="db-days">${daysHtml}</div></div>`;
  }
  const head = `<div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Варки${isDay ? ' — по стадиям' : ' за период'}</div><div class="db-sb">${isDay ? 'где сейчас каждая варка' : 'итог за период'}</div></div><span class="db-badge">${pb.length} всего</span></div>`;
  el.innerHTML = `<div class="db-card" style="--dbc:#8b5cf6">${head}${body}</div>`;
}

// Деталь «Загрузка реакторов»: танки-гейджи, уровень = доля выполненного (выпущено/сварено) по реактору за период.
function renderDashReactors(range) {
  const el = document.getElementById('dash-reactors');
  if (!el) return;
  range = range || dashRange();
  const recBySku = {}; (state.recipes || []).forEach(r => { if (r && r.sku) recBySku[r.sku] = r; });
  const taraOf = b => (b.tara != null ? b.tara : (recBySku[b.sku] ? recBySku[b.sku].tara : 0)) || 0;
  const volOf  = b => (b.volume != null && b.volume > 0) ? b.volume : (b.planQty || 0) * taraOf(b);
  const nf = n => Math.round(n || 0).toLocaleString('ru-RU');
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>`;
  if (!state.reactors.length) { el.innerHTML = `<div class="db-card" style="--dbc:#06b6d4"><div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Загрузка реакторов</div></div></div><div class="db-empty">Нет реакторов</div></div>`; return; }
  const brewedStages = new Set(['brewed', 'pouring', 'poured', 'finished']);
  let working = 0;
  const tanks = state.reactors.map(r => {
    const rb = state.batches.filter(b => b.reactor === r && b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
    const brewedB = rb.filter(b => brewedStages.has(getBatchStage(b)));
    const releasedB = brewedB.filter(b => b.factQty != null);
    const brewedKg = brewedB.reduce((s, b) => s + volOf(b), 0);
    const releasedKg = releasedB.reduce((s, b) => s + volOf(b), 0);
    const done = brewedKg > 0 ? Math.min(100, Math.round(releasedKg / brewedKg * 100)) : 0;
    const active = rb.length > 0; if (active) working++;
    const bySku = {}; rb.forEach(b => { const k = b.name || b.sku || '—'; bySku[k] = (bySku[k] || 0) + 1; });
    const skus = Object.keys(bySku).sort((a, b) => bySku[b] - bySku[a]);
    const prod = skus.length ? (skus.length > 1 ? `${skus[0]} +${skus.length - 1}` : skus[0]) : 'простой';
    return { r, active, done, brewedKg, releasedKg, prod };
  });
  const tanksHtml = tanks.map(t => {
    if (!t.active) return `<div class="dash-tank idle"><div class="dash-tank-cyl"></div><span class="dash-tank-badge" style="background:#64748b">${t.r}</span><div class="dash-tank-done">—</div><div class="dash-tank-s">простой</div></div>`;
    const h = Math.max(t.done > 0 ? 10 : 3, t.done);
    return `<div class="dash-tank" title="${t.r}: сварено ${nf(t.brewedKg)} кг · выпущено ${nf(t.releasedKg)} кг"><div class="dash-tank-cyl"><div class="dash-tank-fill" style="height:${h}%;background:linear-gradient(180deg,#67e8f9,#0891b2)"></div></div><span class="dash-tank-badge" style="background:#06b6d4">${t.r}</span><div class="dash-tank-done" style="color:${t.done >= 100 ? 'var(--accent2)' : 'var(--text)'}">${t.done}%</div><div class="dash-tank-s" title="${t.prod}">${t.prod}</div></div>`;
  }).join('');
  const head = `<div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Загрузка реакторов</div><div class="db-sb">доля выполненного по каждому</div></div><span class="db-badge">${working} / ${state.reactors.length}</span></div>`;
  el.innerHTML = `<div class="db-card" style="--dbc:#06b6d4">${head}<div class="db-bd"><div class="dash-tanks">${tanksHtml}</div></div></div>`;
}

// Деталь «Ожидает розлива»: сварено, но не выпущено — что застряло и сколько ждёт (на сейчас).
function renderDashWaiting(range) {
  const el = document.getElementById('dash-waiting');
  if (!el) return;
  range = range || dashRange();
  const recBySku = {}; (state.recipes || []).forEach(r => { if (r && r.sku) recBySku[r.sku] = r; });
  const taraOf = b => (b.tara != null ? b.tara : (recBySku[b.sku] ? recBySku[b.sku].tara : 0)) || 0;
  const volOf  = b => (b.volume != null && b.volume > 0) ? b.volume : (b.planQty || 0) * taraOf(b);
  const nf = n => Math.round(n || 0).toLocaleString('ru-RU');
  const tf = kg => ((kg || 0) / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const pluVar = n => { const a = Math.abs(n) % 100, b = a % 10; return (a > 10 && a < 20) ? 'варок' : (b === 1 ? 'варка' : (b >= 2 && b <= 4 ? 'варки' : 'варок')); };
  const brewedStages = new Set(['brewed', 'pouring', 'poured', 'finished']);
  const pb = state.batches.filter(b => b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
  const awaitingB = pb.filter(b => brewedStages.has(getBatchStage(b)) && b.factQty == null);
  const waitKg = awaitingB.reduce((s, b) => s + volOf(b), 0);
  const now = new Date();
  const waitMsOf = b => { const end = b.brewEndedAt ? new Date(b.brewEndedAt) : new Date((b.brewDate || range.end) + 'T23:59:59'); return now - end; };
  const OVER = 24 * 3600 * 1000;
  const fmtWait = ms => { if (ms < 0) ms = 0; const h = ms / 3600000; return h < 24 ? Math.max(1, Math.round(h)) + ' ч' : Math.round(h / 24) + ' дн'; };
  const nameOf = b => (b.name || (recBySku[b.sku] && recBySku[b.sku].name) || b.sku || 'Варка');
  const delays = awaitingB.map(b => ({ b, ms: waitMsOf(b) })).filter(x => x.ms > 0).sort((a, c) => c.ms - a.ms).slice(0, 6);
  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M8 3v3.5l4 5.5 4-5.5V3M8 21v-3.5l4-5.5 4 5.5V21"/></svg>`;
  const head = `<div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Ожидает розлива — задержки</div><div class="db-sb">что застряло · на сейчас</div></div><span class="db-badge">${tf(waitKg)} т · ${awaitingB.length} ${pluVar(awaitingB.length)}</span></div>`;
  let body;
  if (!awaitingB.length) {
    body = `<div class="db-bd"><div class="db-ok"><span class="db-ok-dot"></span>Вся сваренная продукция выпущена — задержек нет</div></div>`;
  } else {
    const rows = delays.map(x => {
      const over = x.ms > OVER, col = over ? 'var(--danger)' : 'var(--warn)';
      const ic = over
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
      return `<div class="db-al${over ? ' over' : ''}"><span class="db-ai" style="background:color-mix(in srgb,${col} 20%,transparent);color:${col}">${ic}</span><div class="db-atx">${nameOf(x.b)}<small>${x.b.reactor ? 'Реактор ' + x.b.reactor : 'без реактора'}</small></div><span class="db-aw" style="color:${col}">${fmtWait(x.ms)}${over ? ' · просрочка' : ''}</span></div>`;
    }).join('');
    body = `<div class="db-bd"><div class="db-delays">${rows}</div></div>`;
  }
  el.innerHTML = `<div class="db-card" style="--dbc:#f59e0b">${head}${body}</div>`;
}

// Деталь «Сварено — по продуктам»: объём сваренного за период по продуктам (накопительно).
function renderDashBrewed(range) {
  const el = document.getElementById('dash-brewed');
  if (!el) return;
  range = range || dashRange();
  const recBySku = {}; (state.recipes || []).forEach(r => { if (r && r.sku) recBySku[r.sku] = r; });
  const taraOf = b => (b.tara != null ? b.tara : (recBySku[b.sku] ? recBySku[b.sku].tara : 0)) || 0;
  const volOf  = b => (b.volume != null && b.volume > 0) ? b.volume : (b.planQty || 0) * taraOf(b);
  const nf = n => Math.round(n || 0).toLocaleString('ru-RU');
  const tf = kg => ((kg || 0) / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const brewedStages = new Set(['brewed', 'pouring', 'poured', 'finished']);
  const pb = state.batches.filter(b => b.brewDate >= range.start && b.brewDate <= range.end && b.status !== 'deleted' && b.status !== 'cancelled');
  const brewedB = pb.filter(b => brewedStages.has(getBatchStage(b)));

  const bySku = {};
  brewedB.forEach(b => { const k = b.name || b.sku || '—'; (bySku[k] = bySku[k] || { name: k, kg: 0 }).kg += volOf(b); });
  let rows = Object.values(bySku).sort((a, b) => b.kg - a.kg);
  const totKg = rows.reduce((s, r) => s + r.kg, 0);
  if (rows.length > 6) { const top = rows.slice(0, 6); top.push({ name: 'Прочее', kg: rows.slice(6).reduce((s, r) => s + r.kg, 0) }); rows = top; }
  const maxKg = Math.max(1, ...rows.map(r => r.kg));

  const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="4.5" rx="6.5" ry="2.3"/><path d="M5.5 4.5v15c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3v-15"/><path d="M4.6 9.5h14.8M4.6 14.5h14.8"/></svg>`;
  const head = `<div class="db-hd"><span class="db-ic">${icon}</span><div><div class="db-tt">Сварено — по продуктам</div><div class="db-sb">объём наработки за период</div></div><span class="db-badge">${tf(totKg)} т</span></div>`;
  const body = totKg <= 0
    ? `<div class="db-empty">Нет сваренной продукции за период</div>`
    : `<div class="db-bd">` + rows.map(r => `<div class="db-bar"><span class="nm" title="${r.name}">${r.name}</span><span class="tr"><i style="width:${Math.max(2, Math.round(r.kg / maxKg * 100))}%;background:linear-gradient(90deg,#2563eb,#22d3ee)"></i></span><span class="vl">${nf(r.kg)} кг</span></div>`).join('') + `</div>`;
  el.innerHTML = `<div class="db-card" style="--dbc:#3b82f6">${head}${body}</div>`;
}

function renderBiAnalytics() {
  const pulseEl = document.getElementById('bi-pulse');
  if (!pulseEl) return;

  // Окно горизонта (День/Неделя/Месяц) — единое для всех блоков
  const range = dashRange();

  // Уровень 1 «Пульс дня» — по окну горизонта
  renderPulseDay(range);
  // Детальные блоки — в порядке плиток: Сварено → Выпущено → Варки → Реакторы → Ожидает
  try { renderDashBrewed(range); }   catch (e) { console.error('renderDashBrewed', e); }
  try { renderDashReleased(range); } catch (e) { console.error('renderDashReleased', e); }
  try { renderDashVarki(range); }    catch (e) { console.error('renderDashVarki', e); }
  try { renderDashReactors(range); } catch (e) { console.error('renderDashReactors', e); }
  try { renderDashWaiting(range); }  catch (e) { console.error('renderDashWaiting', e); }
}

// ════════════════════════════════════════════════════════════════════════════
// УПРАВЛЕНИЕ ПРОИЗВОДСТВОМ — назначение линии розлива готовым партиям
// ════════════════════════════════════════════════════════════════════════════
const PM_STAGES = [
  ['queued','В очереди'], ['assigned','Назначена'], ['brewing','Идёт варка'], ['brewed','Сварено'],
  ['pouring','Идёт розлив'], ['poured','Разлито'], ['finished','Готово']
];

// Единая цветовая идентификация стадий (используется и в «Управлении производством»,
// и в терминале оператора варки — чтобы цвета совпадали).
const PM_STAGE_COLORS = { queued:'orange', assigned:'red', brewing:'orange', brewed:'blue', pouring:'green', poured:'blue', finished:'white' };
const PM_STAGE_SHORT = { queued:'Очередь', assigned:'Назначена', brewing:'Варится', brewed:'Сварено', pouring:'Розлив', poured:'Разлито', finished:'Готово' };
// Понятный для варщика текст статуса задания
const BREWOP_STAGE_TEXT = { queued:'В очереди', assigned:'Назначена', brewing:'Идёт варка', brewed:'Варка завершена', pouring:'Идёт розлив', poured:'Разлито', finished:'Готово' };

// Возвращает живые партии (без отменённых/удалённых) на нужной стадии, с учётом
// текущего фильтра по дате — у каждой стадии свой «главный» датовый ориентир:
// до розлива смотрим на дату варки, после передачи в розлив — на дату розлива.
function pmGetDateFilteredBatches(stage) {
  const live = state.batches.filter(b => b.status !== 'deleted' && b.status !== 'cancelled');
  const withStage = live.filter(b => getBatchStage(b) === stage);
  // Активное производство НЕ должно пропадать из-за фильтра по дате — показываем ВСЕ
  // даты для: очередь, назначена, идёт варка, сварено, идёт розлив.
  // Фильтр по дате применяется только к истории: разлито (poured) и готово (finished).
  const ALWAYS_SHOW = ['queued','assigned','brewing','brewed','pouring'];
  if (state.pmShowAll || ALWAYS_SHOW.includes(stage)) return withStage;
  const useDateField = (stage === 'poured' || stage === 'finished') ? 'pouringDate' : 'brewDate';
  return withStage.filter(b => (b[useDateField] || b.brewDate) === state.pmDate);
}

function renderProductionManagement() {
  const tabsEl = document.getElementById('pm-stage-tabs');
  if (!tabsEl) return;
if (!state.pmDate) state.pmDate = fmtDate(new Date());
  if (state.pmShowAll === undefined) state.pmShowAll = true;

  const picker = document.getElementById('pm-date-picker');
  if (picker) picker.value = state.pmDate;
  updateDateNavUI('pm-date-human', 'pm-today-btn', state.pmDate);
  const dateLabelEl = document.getElementById('pm-date-label');
  if (dateLabelEl) dateLabelEl.textContent = state.pmShowAll ? 'Показаны все даты' : fmtDateHuman(state.pmDate);

  const PM_STAGE_EMPTY_LBL = { queued:'Нет в очереди', assigned:'Нет назначенных', brewing:'Не варится', brewed:'Нет сваренных', pouring:'Нет в розливе', poured:'Нет разлитых', finished:'Нет готовых' };
  tabsEl.innerHTML = PM_STAGES.map(([id]) => {
    const count = pmGetDateFilteredBatches(id).length;
    const color = count > 0 ? PM_STAGE_COLORS[id] : 'white';
    return `<button class="reactor-card rcard-${color} ${_pmStage===id?'active':''}" data-stage="${id}" onclick="pmSetStage('${id}',this,event)" style="position:relative;">
      ${count > 0 ? `<span class="rtab-count-badge">${count}</span>` : ''}
      <div class="reactor-card-icon">${getPMStageIcon(id, count > 0)}</div>
      <div class="reactor-card-name" style="font-size:18px;">${PM_STAGE_SHORT[id]}</div>
      <div class="reactor-card-status">
        <span class="status-dot-ind status-dot-${color}"></span>
        ${count > 0 ? count + ' варок' : PM_STAGE_EMPTY_LBL[id]}
      </div>
    </button>`;
  }).join('');

  renderPmContent();
}

function getPMStageIcon(id, hasItems) {
  const s = 'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  // В очереди — пауза/ожидание
  if (id === 'queued') return `<svg ${s} class="rci rci-pause"><circle cx="12" cy="12" r="9"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/></svg>`;
  // Назначена — пользователь с галочкой (задача закреплена за оператором варки)
  if (id === 'assigned') return `<svg ${s} class="rci"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`;
  if (id === 'brewing') return `<svg ${s} class="rci rci-tank"><path d="M6 3h12l1 4H5L6 3z"/><rect x="4" y="7" width="16" height="11" rx="2"/><path d="M4 12h16"/><circle cx="9" cy="15.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="15.5" r="1" fill="currentColor" stroke="none"/><path d="M8 18v3m8-3v3"/></svg>`;
  if (id === 'brewed') return `<svg ${s} class="rci"><circle cx="12" cy="12" r="9"/><path class="rci-clock-hand" d="M12 7v5l3 2"/></svg>`;
  if (id === 'pouring') return `<svg ${s} class="rci rci-bottles"><rect x="1" y="3" width="22" height="2" rx="1"/><line x1="6" y1="5" x2="6" y2="8"/><line x1="12" y1="5" x2="12" y2="8"/><line x1="18" y1="5" x2="18" y2="8"/><path d="M4.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M10.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M16.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><rect x="1" y="19" width="22" height="3" rx="1.5"/><circle cx="5" cy="20.5" r="1.5"/><circle cx="19" cy="20.5" r="1.5"/></svg>`;
  if (id === 'poured') return `<svg ${s} class="rci rci-check"><circle cx="12" cy="12" r="9"/><polyline points="8,12 10.5,14.5 16,9"/></svg>`;
  if (id === 'finished') return `<svg ${s} class="rci rci-star"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  return `<svg ${s} class="rci"><circle cx="12" cy="12" r="9"/></svg>`;
}

function pmSetStage(stage, btn, ev) {
  if (ev) ev.stopPropagation();
  setPmStage(stage); // toggle + sessionStorage + re-render
}

function pmShiftDay(delta) {
  state.pmShowAll = false;
  state.pmDate = fmtDate(addDays(new Date(state.pmDate), delta));
  saveState();
  renderProductionManagement();
}
function pmGoToDate(iso) {
  if (!iso) return;
  state.pmShowAll = false;
  state.pmDate = iso;
  saveState();
  renderProductionManagement();
}
function pmGoToday() {
  state.pmShowAll = false;
  state.pmDate = fmtDate(new Date());
  saveState();
  renderProductionManagement();
}
function pmShowAllDates() {
  state.pmShowAll = true;
  saveState();
  renderProductionManagement();
}

function renderPmContent() {
  const el = document.getElementById('pm-content');
  if (!el) return;
  if (!_pmStage || _pmStage === 'none' || _pmStage === '') {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 10h18M3 14h12M3 18h8"/><polyline points="17 14 21 17 17 20"/></svg></div><div class="empty-title">Выберите этап</div><div>Нажмите на карточку выше</div></div>`;
    return;
  }
  const batches = pmGetDateFilteredBatches(_pmStage).sort((a,b) => new Date(a.brewDate) - new Date(b.brewDate));

  if (!batches.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-title">Пусто</div><div>Нет партий на этой вкладке${state.pmShowAll ? '' : ' за выбранную дату'}</div></div>`;
    return;
  }

  if (_pmStage === 'queued')   { el.innerHTML = batches.map(pmQueuedCard).join(''); return; }
  if (_pmStage === 'assigned') { el.innerHTML = batches.map(pmAssignedCard).join(''); return; }
  if (_pmStage === 'brewed')   { el.innerHTML = batches.map(pmBrewedCard).join(''); return; }
  el.innerHTML = batches.map(b => pmMonitorCard(b)).join('');
}

// Сворачивает/разворачивает детальную часть карточки на «В очереди»/«Идёт варка»/
// «Варка завершена» — по умолчанию все карточки свёрнуты, видно только основное.
function togglePmCard(id) {
  const details = document.getElementById(`pm-card-details-${id}`);
  const chevron = document.getElementById(`pm-card-chevron-${id}`);
  if (!details) return;
  const isHidden = details.style.display === 'none' || !details.style.display;
  details.style.display = isHidden ? 'block' : 'none';
  if (chevron) chevron.textContent = isHidden ? '▴' : '▾';
}

function pmStageBadge(stage) {
  const colors = { queued:'var(--text2)', brewing:'var(--warn)', brewed:'var(--accent)', pouring:'var(--accent2)', poured:'var(--purple)', finished:'var(--accent2)' };
  const c = colors[stage] || 'var(--text2)';
  return `<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; background:${c}22; color:${c}; white-space:nowrap;">${BATCH_STAGE_LABELS[stage]||stage}</span>`;
}

// Карточка на вкладке «В очереди» — свёрнута по умолчанию, разворачивается по клику.
// Внутри: дата варки, реактор, заранее линия и комментарий варщику перед передачей.
function pmQueuedCard(b) {
  const pourRoles = getIntakeOperatorRoles();
  const brewRoles = getBrewingOperatorRoles();
  const assignedPour = b.assignedOperatorRoleId ? getRoleById(b.assignedOperatorRoleId) : null;
  return `<div class="card" style="padding:0; overflow:hidden;">
    <div style="padding:14px 16px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:10px;" onclick="togglePmCard('${b.id}')">
      <div style="min-width:0;">
        <div style="font-size:15px; font-weight:700;">${b.name} <span style="color:var(--text3); font-size:12px; font-weight:500;">${b.id}</span></div>
        <div class="batch-meta" style="margin-top:4px;"><span>${fmtDateHuman(b.brewDate)}</span><span>${b.reactor}</span><span>${b.planQty} шт</span>${b.pouringLine ? `<span>${b.pouringLine}</span>` : ''}${assignedPour ? `<span>${assignedPour.login}</span>` : ''}</div>
      </div>
      <span id="pm-card-chevron-${b.id}" style="font-size:12px; color:var(--text2); flex-shrink:0;">▾</span>
    </div>
    <div id="pm-card-details-${b.id}" style="display:none; padding:0 16px 16px;">
      <div class="grid-2" style="margin-top:6px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>Дата варки</label>
          <input type="date" id="pmq-date-${b.id}" value="${b.brewDate}" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Реактор</label>
          <select id="pmq-reactor-${b.id}">${state.reactors.map(r=>`<option value="${r}" ${r===b.reactor?'selected':''}>${r}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Оператор варки <span style="color:var(--warn);">*</span></label>
        <select id="pmq-brewop-${b.id}" onchange="pmCheckQueuedReady('${b.id}')">
          <option value="">— выбрать оператора варки —</option>
          ${brewRoles.map(r=>`<option value="${r.id}" ${r.id===b.assignedBrewingOperatorRoleId?'selected':''}>${r.login}</option>`).join('')}
        </select>
        ${!brewRoles.length ? `<div class="field-hidden-note" style="margin-top:4px;">Нет ролей-операторов варки — заведите роль с единственной вкладкой «Участок варки» в Админ → Роли.</div>` : ''}
      </div>
      <div class="grid-2" style="margin-top:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>Линия розлива (заранее, необязательно)</label>
          <select id="pmq-line-${b.id}">
            <option value="">— не выбрано —</option>
            ${state.pouringLines.map(l=>`<option value="${l}" ${l===b.pouringLine?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Оператор розлива (заранее, необязательно)</label>
          <select id="pmq-operator-${b.id}">
            <option value="">— не выбрано —</option>
            ${pourRoles.map(r=>`<option value="${r.id}" ${r.id===b.assignedOperatorRoleId?'selected':''}>${r.login}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Комментарий для варщика</label>
        <textarea id="pmq-comment-${b.id}" rows="2" placeholder="Необязательно">${b.commentForWarshchik||''}</textarea>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Комментарий для оператора розлива</label>
        <textarea id="pmq-pouring-comment-${b.id}" rows="2" placeholder="Необязательно">${b.commentForPouring||''}</textarea>
      </div>
      <button id="pmq-send-btn-${b.id}" class="btn btn-primary btn-full" style="margin-top:6px;" onclick="assignBrewing('${b.id}')">Назначить варку</button>
    </div>
  </div>`;
}

// Кнопка «Назначить варку» теперь всегда активна — точную причину отказа (нет роли
// «Оператор варки» / оператор не выбран) показывает тост в assignBrewing, без тихой
// блокировки disabled-кнопкой. Функция оставлена для onchange-хука селекта (no-op).
function pmCheckQueuedReady(batchId) { /* кнопка всегда активна, см. assignBrewing */ }

// Главный оператор назначает варку из очереди: задаёт дату, реактор, ОПЕРАТОРА ВАРКИ
// (обязательно), опционально заранее — линию/оператора розлива и комментарии.
// Результат: партия выходит из очереди и переходит в стадию «Назначена» (assigned),
// появляется на телефоне у назначенного оператора варки. Статус остаётся 'planned'
// до тех пор, пока варщик сам не нажмёт «Начать варку».
function assignBrewing(batchId) {
  if (!canDo('assignBrewing')) { showToast('Недостаточно прав для назначения варки'); return; }
  const b = getBatchById(batchId);
  if (!b) return;

  const dateInput = document.getElementById(`pmq-date-${batchId}`);
  const reactorInput = document.getElementById(`pmq-reactor-${batchId}`);
  const brewOpInput = document.getElementById(`pmq-brewop-${batchId}`);
  const lineInput = document.getElementById(`pmq-line-${batchId}`);
  const operatorInput = document.getElementById(`pmq-operator-${batchId}`);
  const commentInput = document.getElementById(`pmq-comment-${batchId}`);
  const pouringCommentInput = document.getElementById(`pmq-pouring-comment-${batchId}`);

  const newDate = dateInput ? dateInput.value : b.brewDate;
  const newReactor = reactorInput ? reactorInput.value : b.reactor;
  const newBrewOpRoleId = brewOpInput ? (brewOpInput.value || null) : b.assignedBrewingOperatorRoleId;
  const newLine = lineInput ? lineInput.value : '';
  const newOperatorRoleId = operatorInput ? (operatorInput.value || null) : b.assignedOperatorRoleId;
  const newComment = commentInput ? commentInput.value : (b.commentForWarshchik || '');
  const newPouringComment = pouringCommentInput ? pouringCommentInput.value : (b.commentForPouring || '');

  // Точная причина вместо тихой блокировки: если ролей «Оператор варки» нет вообще —
  // назначать некого. Сообщаем, как это исправить (Админ → Роли).
  if (!getBrewingOperatorRoles().length) {
    showToast('Нет ни одной роли «Оператор варки». Создайте её в Админ → Роли — роль с единственной вкладкой «Участок варки»');
    return;
  }
  // Оператор варки — единственное обязательное поле при назначении
  if (!newBrewOpRoleId) { showToast('Выберите оператора варки из списка перед назначением'); return; }
  const brewRole = getRoleById(newBrewOpRoleId);
  const brewOpName = brewRole ? brewRole.login : null;

  if (newDate !== b.brewDate || newReactor !== b.reactor) {
    const check = checkConflict(newReactor, newDate, b.brewHours || 0, b.id);
    if (check.conflict) {
      const ok = confirm(`Реактор ${newReactor} на ${fmtDateHuman(newDate)} уже загружен на ${check.load}ч из ${state.workdayHours}ч. Эта варка (${b.brewHours}ч) превысит лимит. Назначить всё равно?`);
      if (!ok) return;
    }
  }

  b.brewDate = newDate;
  b.reactor = newReactor;
  b.assignedBrewingOperatorRoleId = newBrewOpRoleId;
  b.assignedBrewingOperatorName = brewOpName;
  if (newLine) b.pouringLine = newLine;
  b.assignedOperatorRoleId = newOperatorRoleId;
  b.commentForWarshchik = newComment;
  b.commentForPouring = newPouringComment;
  // гейт выхода из очереди → стадия «Назначена». Статус остаётся planned, метки старта нет.
  b.assignedToBrewing = true;
  b.sentToBrewing = true; // backward-compat для старых проверок

  logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Управление производством', page: 'production', pmStage: 'assigned',
    text: `Главный оператор назначил варку партии ${b.id} оператору «${brewOpName}». Реактор ${b.reactor}, дата ${fmtDateHuman(b.brewDate)}.` });
  logActivity('Варка назначена', { target: b.id, after: {
    product: b.name, reactor: b.reactor, brewDate: b.brewDate,
    brewingOperator: brewOpName, brewingOperatorRoleId: newBrewOpRoleId, line: b.pouringLine || null
  } });
  saveState();
  render();
  showToast(`${batchId} назначена · оператор «${brewOpName}»`);
}

// Карточка на вкладке «Назначена» — мониторинг для главного оператора. Партия уже
// назначена оператору варки и ждёт, пока он нажмёт «Начать варку». Только просмотр.
function pmAssignedCard(b) {
  const brewName = b.assignedBrewingOperatorName
    || (b.assignedBrewingOperatorRoleId ? (getRoleById(b.assignedBrewingOperatorRoleId)||{}).login : null)
    || '—';
  return `<div class="card">
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
      <div style="min-width:0;">
        <div style="font-size:15px; font-weight:700;">${b.name} <span style="color:var(--text3); font-size:12px; font-weight:500;">${b.id}</span></div>
        <div class="batch-meta" style="margin-top:4px;">
          <span>${fmtDateHuman(b.brewDate)}</span>
          <span>Реактор: <strong>${b.reactor}</strong></span>
          <span>План: ${b.planQty} шт</span>
          <span>Оператор варки: <strong>${brewName}</strong></span>
          ${b.pouringLine ? `<span>${b.pouringLine}</span>` : ''}
        </div>
        ${b.commentForWarshchik ? `<div class="note" style="margin-top:6px;">📝 Варщику: ${b.commentForWarshchik}</div>` : ''}
      </div>
      <span style="flex-shrink:0; font-size:12px; font-weight:700; color:var(--warn); padding:3px 10px; border-radius:10px; background:var(--warn-bg, rgba(220,80,40,.12));">Ждёт старта</span>
    </div>
  </div>`;
}

// Карточка на вкладке «Варка завершена» — линия розлива обязательна перед передачей.
function pmBrewedCard(b) {
  const hasLine = !!b.pouringLine;
  const operatorRoles = getIntakeOperatorRoles();
  const assignedRole = b.assignedOperatorRoleId ? getRoleById(b.assignedOperatorRoleId) : null;
  return `<div class="card" style="padding:0; overflow:hidden;">
    <div style="padding:14px 16px; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:10px;" onclick="togglePmCard('${b.id}')">
      <div style="min-width:0;">
        <div style="font-size:15px; font-weight:700;">${b.name} <span style="color:var(--text3); font-size:12px; font-weight:500;">${b.id}</span></div>
        <div class="batch-meta" style="margin-top:4px;"><span>План: <strong>${b.planQty} шт</strong></span><span>сварено ${fmtDateHuman(b.brewDate)}</span>${hasLine ? `<span>${b.pouringLine}</span>` : `<span style="color:var(--warn); font-weight:600;">Линия не назначена</span>`}${assignedRole ? `<span>${assignedRole.login}</span>` : ''}</div>
      </div>
      <span id="pm-card-chevron-${b.id}" style="font-size:12px; color:var(--text2); flex-shrink:0;">▾</span>
    </div>
    <div id="pm-card-details-${b.id}" style="display:none; padding:0 16px 16px;">
      <div class="form-group" style="margin-top:6px;">
        <label>Линия розлива</label>
        <select id="pmb-line-${b.id}" onchange="document.getElementById('pmb-send-btn-${b.id}').disabled = !this.value;">
          <option value="">— выбрать линию —</option>
          ${state.pouringLines.map(l=>`<option value="${l}" ${l===b.pouringLine?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Оператор розлива (необязательно)</label>
        <select id="pmb-operator-${b.id}">
          <option value="">— не назначен —</option>
          ${operatorRoles.map(r=>`<option value="${r.id}" ${r.id===b.assignedOperatorRoleId?'selected':''}>${r.login}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Дата розлива</label>
        <input type="date" id="pmb-date-${b.id}" value="${b.pouringDate || fmtDate(new Date())}" />
      </div>
      <div class="form-group" style="margin-top:10px;">
        <label>Комментарий для оператора розлива</label>
        <textarea id="pmb-comment-${b.id}" rows="2" placeholder="Необязательно">${b.commentForPouring||''}</textarea>
      </div>
      <button id="pmb-send-btn-${b.id}" class="btn btn-primary btn-full" style="margin-top:6px;" ${hasLine?'':'disabled'} onclick="sendToPouring('${b.id}')">Передать в розлив</button>
    </div>
  </div>`;
}

function sendToPouring(batchId) {
  if (!canDo('sendToPouring')) { showToast('Недостаточно прав для передачи в розлив'); return; }
  const b = getBatchById(batchId);
  if (!b) return;

  const lineInput = document.getElementById(`pmb-line-${batchId}`);
  const dateInput = document.getElementById(`pmb-date-${batchId}`);
  const commentInput = document.getElementById(`pmb-comment-${batchId}`);
  const operatorInput = document.getElementById(`pmb-operator-${batchId}`);
  const line = lineInput ? lineInput.value : (b.pouringLine || '');
  const operatorRoleId = operatorInput ? (operatorInput.value || null) : b.assignedOperatorRoleId;

  if (!line) { showToast('Назначьте линию розлива перед передачей партии в розлив'); return; }


  const lineChanged = line !== (b.pouringLine || '');
  const commentVal = commentInput ? commentInput.value : (b.commentForPouring || '');
  const commentChanged = commentVal !== (b.commentForPouring || '');
  const operatorChanged = operatorRoleId !== b.assignedOperatorRoleId;

  if (lineChanged) logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Управление производством', page: 'production', pmStage: 'brewed',
    text: b.pouringLine ? `Главный оператор изменил линию розлива партии ${b.id}: с «${b.pouringLine}» на «${line}».` : `Главный оператор назначил линию розлива «${line}» для партии ${b.id}.` });
  if (commentChanged) logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Управление производством', page: 'production', pmStage: 'pouring',
    text: `Главный оператор оставил комментарий для оператора розлива по партии ${b.id}.` });
  if (operatorChanged) {
    const role = operatorRoleId ? getRoleById(operatorRoleId) : null;
    logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Управление производством', page: 'production', pmStage: 'pouring',
      text: role ? `Главный оператор назначил оператора «${role.login}» на партию ${b.id}.` : `Главный оператор снял назначение оператора с партии ${b.id}.` });
  }

  b.pouringLine = line;
  b.pouringDate = (dateInput && dateInput.value) ? dateInput.value : fmtDate(new Date());
  b.commentForPouring = commentVal;
  b.assignedOperatorRoleId = operatorRoleId;
  b.sentToPouring = true;
  logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Управление производством', page: 'production', pmStage: 'pouring',
    text: `Главный оператор передал партию ${b.id} в розлив. Линия: «${line}».` });
  logActivity('Партия передана в розлив', { target: b.id, after: { line, pouringDate: b.pouringDate } });
  saveState();
  render();
  showToast(`${batchId} передана в розлив · линия «${line}»`);
}

// Карточки для остальных вкладок («Все», «Идёт варка», «Идёт розлив», «Розлив
// завершён», «Готово») — это только мониторинг, без действий главного оператора.
function pmMonitorCard(b) {
  const stage = getBatchStage(b);
  let extra = '';
  if (stage === 'queued') {
    extra = `<div class="batch-meta" style="margin-top:6px;"><span>${fmtDateHuman(b.brewDate)}</span><span>Реактор: ${b.reactor}</span></div>`;
  } else if (stage === 'brewing') {
    const pct = getBrewProgressPct(b);
    const assignedRole = b.assignedOperatorRoleId ? getRoleById(b.assignedOperatorRoleId) : null;
    extra = `<div class="batch-meta" style="margin-top:6px;">
      <span>Реактор: <strong>${b.reactor}</strong></span>
      <span>${b.status==='active' ? `Варится · ${pct}%` : 'Ждёт очереди на реактор'}</span>
      ${b.pouringLine ? `<span>${b.pouringLine}</span>` : ''}
      ${assignedRole ? `<span>${assignedRole.login}</span>` : ''}
      ${b.commentForWarshchik ? `<span>📝 ${b.commentForWarshchik}</span>` : ''}
    </div>`;
  } else if (stage === 'brewed') {
    extra = `<div class="batch-meta" style="margin-top:6px;"><span>${b.pouringLine ? `Линия: ${b.pouringLine}` : '<span style="color:var(--warn)">Линия не назначена</span>'}</span></div>`;
  } else if (stage === 'pouring') {
    extra = `<div class="batch-meta" style="margin-top:6px;">
      <span>Линия: <strong>${b.pouringLine||'—'}</strong></span>
      <span>${fmtDateHuman(b.pouringDate||b.brewDate)}</span>
      ${b.pouringOperatorName ? `<span>${b.pouringOperatorName}</span>` : ''}
      ${b.pouringStartedAt ? `<span>Начат: ${new Date(b.pouringStartedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>` : ''}
      ${b.commentForPouring ? `<span>📝 ${b.commentForPouring}</span>` : ''}
    </div>`;
  } else if (stage === 'poured') {
    extra = `<div class="batch-meta" style="margin-top:6px;">
      <span>Линия: <strong>${b.pouringLine||'—'}</strong></span>
      <span>План: <strong>${b.planQty}</strong></span>
      <span style="color:var(--warn); font-weight:600;">Количество не введено</span>
      ${b.pouringEndedAt ? `<span>Завершён: ${new Date(b.pouringEndedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>` : ''}
    </div>`;
  } else if (stage === 'finished') {
    const dev = b.planQty ? ((b.factQty - b.planQty) / b.planQty * 100) : 0;
    const color = Math.abs(dev) <= 3 ? 'var(--accent2)' : 'var(--warn)';
    extra = `<div class="batch-meta" style="margin-top:6px;">
      <span>План: <strong>${b.planQty}</strong></span>
      <span>Факт: <strong>${b.factQty}</strong></span>
      <span style="color:${color}; font-weight:700;">${dev>0?'+':''}${dev.toFixed(1)}%</span>
      <span>Линия: ${b.pouringLine||'—'}</span>
    </div>`;
  }
  return `<div class="card">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
      <div style="font-size:15px; font-weight:700;">${b.name} <span style="color:var(--text3); font-size:12px; font-weight:500;">${b.id}</span></div>
      ${pmStageBadge(stage)}
    </div>
    ${extra}
  </div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// НЕДЕЛЬНЫЙ ПЛАН (расчётный — не создаёт варки)
// ════════════════════════════════════════════════════════════════════════════
const WP_DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

function wpShiftWeek(delta) {
  state.wpWeekStart = fmtDate(addDays(new Date(state.wpWeekStart), delta * 7));
  saveState();
  renderWeekPlan();
}
function wpGoCurrentWeek() {
  state.wpWeekStart = getMondayOf(new Date());
  saveState();
  renderWeekPlan();
}

function wpGetWeekDays() {
  const start = new Date(state.wpWeekStart);
  return Array.from({length:7}, (_,i) => fmtDate(addDays(start, i)));
}

function wpDemandFor(sku, client) {
  const week = state.wpDemand[state.wpWeekStart];
  if (!week || !week[sku]) return 0;
  return week[sku][client] || 0;
}
function wpSetDemand(sku, client, qty) {
  if (!state.wpDemand[state.wpWeekStart]) state.wpDemand[state.wpWeekStart] = {};
  if (!state.wpDemand[state.wpWeekStart][sku]) state.wpDemand[state.wpWeekStart][sku] = {};
  state.wpDemand[state.wpWeekStart][sku][client] = qty || 0;
  saveState();
}
function wpBrewFor(sku, dateIso) {
  const week = state.wpBrewPlan[state.wpWeekStart];
  if (!week || !week[sku]) return 0;
  return week[sku][dateIso] || 0;
}
function wpSetBrew(sku, dateIso, qty) {
  if (!state.wpBrewPlan[state.wpWeekStart]) state.wpBrewPlan[state.wpWeekStart] = {};
  if (!state.wpBrewPlan[state.wpWeekStart][sku]) state.wpBrewPlan[state.wpWeekStart][sku] = {};
  state.wpBrewPlan[state.wpWeekStart][sku][dateIso] = qty || 0;
  const gen = state.wpGenerated[state.wpWeekStart];
  if (gen && gen[sku] && gen[sku][dateIso]) {
    delete gen[sku][dateIso];
  }
  saveState();
}

function wpIsGenerated(sku, dateIso) {
  const gen = state.wpGenerated[state.wpWeekStart];
  const entry = gen && gen[sku] && gen[sku][dateIso];
  if (!entry) return false;
  // новый формат — массив batchIds (может, в теории, быть пустым — тогда не считается сформированным);
  // старый формат — одиночная строка либо объект { batchId }
  if (typeof entry === 'object' && Array.isArray(entry.batchIds)) return entry.batchIds.length > 0;
  return true;
}

function wpGeneratedBatchId(sku, dateIso) {
  const gen = state.wpGenerated[state.wpWeekStart];
  const entry = gen && gen[sku] && gen[sku][dateIso];
  if (!entry) return null;
  return (typeof entry === 'object') ? entry.batchId : entry; // поддержка старого формата (просто строка)
}

function renderWeekPlan() {
  const table = document.getElementById('wp-table');
  if (!table) return;

  const weekDays = wpGetWeekDays();
  const weekLabel = document.getElementById('wp-week-label');
  if (weekLabel) weekLabel.textContent = `${fmtDateHuman(weekDays[0])} — ${fmtDateHuman(weekDays[6])}`;

  const clients = state.wpClients.length ? state.wpClients : state.clients;
  const hiddenClients = state.clients.filter(c => !state.wpClients.includes(c));

  let html = '<thead><tr>';
  html += `<th style="position:sticky; left:0; background:var(--surface3); text-align:left; padding:10px 12px; border:1px solid var(--border); min-width:180px; z-index:2; font-size:12px; text-transform:uppercase; letter-spacing:0.4px; color:var(--text2);">Продукт</th>`;
  clients.forEach(c => html += `<th style="padding:10px 6px; border:1px solid var(--border); min-width:64px; text-align:center; font-weight:700; background:var(--surface2);">${c}</th>`);
  html += `<th style="padding:8px 6px; border:1px solid var(--border); background:var(--surface3); min-width:60px;">Надо</th>`;
  html += `<th style="padding:8px 6px; border:1px solid var(--border); background:var(--surface3); min-width:70px;">Остаток</th>`;
  html += `<th style="padding:8px 6px; border:1px solid var(--border); background:var(--surface3); min-width:80px;">Надо сварить</th>`;
  weekDays.forEach(d => html += `<th style="padding:8px 4px; border:1px solid var(--border); min-width:55px; text-align:center; font-size:10px; background:var(--surface2);">${WP_DAY_NAMES[new Date(d).getDay()===0?6:new Date(d).getDay()-1]}<br>${d.slice(8,10)}.${d.slice(5,7)}</th>`);
  html += `<th style="padding:8px 6px; border:1px solid var(--border); background:var(--surface3); min-width:70px;">Сварено</th>`;
  html += `<th style="padding:8px 6px; border:1px solid var(--border); background:var(--surface3); min-width:70px;">Остаток</th>`;
  html += '</tr></thead><tbody>';

  const activeRecipes = state.recipes.filter(r => r.activeInPlan !== false);
  const inactiveRecipes = state.recipes.filter(r => r.activeInPlan === false);

  activeRecipes.forEach(r => {
    const sku = r.sku;
    let needTotal = 0;
    let rowCells = '';
    clients.forEach(c => {
      const val = wpDemandFor(sku, c);
      needTotal += val;
      rowCells += `<td style="padding:2px; border:1px solid var(--border);">
        <input type="number" value="${val || ''}" placeholder="0" min="0"
          style="width:100%; padding:4px; font-size:12px; text-align:center; background:var(--surface2); border:1px solid var(--border); border-radius:4px;"
          onchange="wpSetDemand('${sku}','${c}', parseFloat(this.value)||0); renderWeekPlan();" />
      </td>`;
    });

    const stock = state.stockLevels[sku] || 0;
    const needToBrew = needTotal - stock;
    const needColor = needToBrew > 0 ? 'var(--warn)' : 'var(--accent2)';

    let brewTotal = 0;
    let brewCells = '';
    weekDays.forEach(d => {
      const val = wpBrewFor(sku, d);
      brewTotal += val;
      // подсветка "уже сформировано" нужна только если в ячейке реально есть значение —
      // после обнуления плана пустая ячейка не должна выглядеть как "сделанная"
      const generated = wpIsGenerated(sku, d) && val > 0;
      brewCells += `<td style="padding:2px; border:1px solid var(--border); position:relative;">
        <input type="number" value="${val || ''}" placeholder="0" min="0"
          style="width:100%; padding:4px; font-size:12px; text-align:center; background:${generated?'rgba(16,185,129,.12)':'var(--surface2)'}; border:1px solid ${generated?'var(--accent2)':'var(--border)'}; border-radius:4px; color:var(--accent2); font-weight:600;"
          onchange="wpSetBrew('${sku}','${d}', parseFloat(this.value)||0); renderWeekPlan();"
          title="${generated ? 'Уже сформировано в производство' : ''}" />
        ${generated ? `<span style="position:absolute; top:0; right:2px; font-size:9px; color:var(--accent2);" title="В производстве">✓</span>` : ''}
      </td>`;
    });

    const finalStock = stock + brewTotal - needTotal;

    html += `<tr>
      <td style="padding:8px 10px; border:1px solid var(--border); position:sticky; left:0; background:var(--surface); font-weight:600; white-space:nowrap;">
        <div>${r.name}</div>
        <div style="font-size:10px; color:var(--text3); margin-top:2px;">${r.brewHours||2}ч варки</div>
      </td>
      ${rowCells}
      <td style="padding:6px; border:1px solid var(--border); text-align:center; font-weight:700; background:var(--surface2);">${needTotal}</td>
      <td style="padding:2px; border:1px solid var(--border); background:var(--surface2);">
        <input type="number" value="${stock || ''}" placeholder="0" min="0"
          style="width:100%; padding:4px; font-size:12px; text-align:center; background:var(--surface3); border:1px solid var(--border); border-radius:4px; font-weight:600;"
          onchange="wpSetStock('${sku}', parseFloat(this.value)||0)" />
      </td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center; font-weight:800; color:${needColor}; background:var(--surface2);">${needToBrew > 0 ? needToBrew : 0}${needToBrew <= 0 ? ' ✓' : ''}</td>
      ${brewCells}
      <td style="padding:6px; border:1px solid var(--border); text-align:center; font-weight:700; color:var(--accent2); background:var(--surface2);">${brewTotal}</td>
      <td style="padding:6px; border:1px solid var(--border); text-align:center; font-weight:700; background:var(--surface2); color:${finalStock<0?'var(--danger)':'var(--text)'};">${finalStock}</td>
    </tr>`;
  });

  html += '</tbody>';
  table.innerHTML = html;

  // ── сводка для кнопки генерации ──
  const summaryEl = document.getElementById('wp-generate-summary');
  if (summaryEl) {
    let cellsToGenerate = 0, cellsAlreadyGenerated = 0;
    activeRecipes.forEach(r => {
      weekDays.forEach(d => {
        const qty = wpBrewFor(r.sku, d);
        if (qty > 0) {
          if (wpIsGenerated(r.sku, d)) cellsAlreadyGenerated++;
          else cellsToGenerate++;
        }
      });
    });
    if (cellsToGenerate === 0 && cellsAlreadyGenerated === 0) {
      summaryEl.textContent = 'Распределите «надо сварить» по дням недели, затем сформируйте производство';
    } else if (cellsToGenerate === 0) {
      summaryEl.innerHTML = `<span style="color:var(--accent2);">✓ Весь план недели уже сформирован в производство (${cellsAlreadyGenerated} варок)</span>`;
    } else {
      summaryEl.innerHTML = `<span style="color:var(--warn); font-weight:600;">${cellsToGenerate} ${cellsToGenerate===1?'позиция':'позиций'} готовы к формированию</span>${cellsAlreadyGenerated ? ` · ${cellsAlreadyGenerated} уже в производстве` : ''}`;
    }
  }

  renderWpHistory();
}

function toggleWpHistory() {
  state.wpHistoryCollapsed = !state.wpHistoryCollapsed;
  saveState();
  renderWpHistory();
}

function toggleWpHistoryWeek(weekStart) {
  const details = document.getElementById(`wp-history-details-${weekStart}`);
  const chevron = document.getElementById(`wp-history-chevron-${weekStart}`);
  if (!details) return;
  const isHidden = details.style.display === 'none' || !details.style.display;
  details.style.display = isHidden ? 'block' : 'none';
  if (chevron) chevron.textContent = isHidden ? '▴' : '▾';
}

// Собирает все сформированные позиции по всем неделям (включая текущую) из
// state.wpGenerated и показывает их сгруппированными по неделе — отдельно от
// рабочей таблицы выше, чтобы не мешать планированию. Каждая неделя свёрнута
// по умолчанию, разворачивается по клику.
function renderWpHistory() {
  const arrowEl = document.getElementById('wp-history-toggle-arrow');
  const listEl = document.getElementById('wp-history-list');
  if (!listEl) return;

  if (arrowEl) arrowEl.textContent = state.wpHistoryCollapsed ? '▾ показать' : '▴ свернуть';
  listEl.style.display = state.wpHistoryCollapsed ? 'none' : 'block';
  if (state.wpHistoryCollapsed) return;

  const weekKeys = Object.keys(state.wpGenerated).sort((a,b) => b.localeCompare(a)); // новые недели сверху
  if (!weekKeys.length) {
    listEl.innerHTML = `<div class="note">Пока ничего не сформировано.</div>`;
    return;
  }

  listEl.innerHTML = weekKeys.map(weekStart => {
    const weekData = state.wpGenerated[weekStart];
    const rows = [];
    Object.keys(weekData).forEach(sku => {
      const recipe = state.recipes.find(r => r.sku === sku);
      Object.keys(weekData[sku]).forEach(date => {
        const entry = weekData[sku][date];
        const qty = (entry && typeof entry === 'object' && entry.qty !== undefined) ? entry.qty : 0;
        // entry может быть: старая строка-id, старый {batchId}, новый {batchIds:[...]}
        let batchIds = [];
        if (entry && typeof entry === 'object' && Array.isArray(entry.batchIds)) batchIds = entry.batchIds;
        else if (entry && typeof entry === 'object' && entry.batchId) batchIds = [entry.batchId];
        else if (entry && typeof entry !== 'object') batchIds = [entry];
        const batches = batchIds.map(id => ({ id, batch: getBatchById(id) }));
        rows.push({ sku, name: recipe ? recipe.name : sku, date, qty, batches });
      });
    });
    rows.sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const weekEnd = fmtDate(addDays(new Date(weekStart), 6));

    return `<div class="card" style="margin-bottom:10px; padding:0; overflow:hidden;">
      <div style="padding:12px 16px; cursor:pointer; display:flex; align-items:center; justify-content:space-between;" onclick="toggleWpHistoryWeek('${weekStart}')">
        <div style="font-weight:700; font-size:13px;">${fmtDateHuman(weekStart)} — ${fmtDateHuman(weekEnd)} · ${rows.length} ${rows.length===1?'позиция':'позиций'}</div>
        <span id="wp-history-chevron-${weekStart}" style="font-size:12px; color:var(--text2);">▾</span>
      </div>
      <div id="wp-history-details-${weekStart}" style="display:none; padding:0 16px 12px;">
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${rows.map(row => `<div style="display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid var(--border); font-size:12px;">
            <span style="color:var(--text2); width:80px; flex-shrink:0;">${fmtDateHuman(row.date)}</span>
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${row.name}</span>
            <span style="color:var(--text2);">${row.qty} шт</span>
            <span style="color:var(--text3); font-size:11px; text-align:right;">${row.batches.map(x => x.batch ? x.id : `${x.id} (удалена)`).join(', ') || '—'}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleRecipeInPlan(sku, makeActive) {
  const r = state.recipes.find(x => x.sku === sku);
  if (r) { r.activeInPlan = makeActive; saveState(); renderWeekPlan(); }
}

// ════════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ПРОИЗВОДСТВА ИЗ НЕДЕЛЬНОГО ПЛАНА
// Превращает заполненные ячейки (продукт × день × кол-во) в реальные сводные
// варки: считает объём из тары рецептуры, берёт время варки из рецептуры,
// автоматически назначает наименее загруженный реактор на эту дату.
// Не делит по клиентам — варка идёт как общая производственная задача.
// ════════════════════════════════════════════════════════════════════════════
function generateProductionFromWeekPlan() {
  const weekDays = wpGetWeekDays();
  const activeRecipes = state.recipes.filter(r => r.activeInPlan !== false);

  // собираем все ячейки, которые нужно сформировать (ещё не сформированы)
  const toGenerate = [];
  activeRecipes.forEach(r => {
    weekDays.forEach(d => {
      const qty = wpBrewFor(r.sku, d);
      if (qty > 0 && !wpIsGenerated(r.sku, d)) {
        toGenerate.push({ sku: r.sku, recipe: r, date: d, qty });
      }
    });
  });

  if (!toGenerate.length) {
    showToast('Нет новых позиций для формирования — распределите «надо сварить» по дням');
    return;
  }

  // сортируем по дате, чтобы реакторы заполнялись по хронологии недели
  toGenerate.sort((a,b) => a.date.localeCompare(b.date));

  // runningLoads считает часы, уже "виртуально" назначенные в этом проходе,
  // отдельно по каждой дате — чтобы несколько варок в один день не сели в один реактор
  const runningLoadsByDate = {};
  const conflicts = [];
  let createdCount = 0;

  toGenerate.forEach(item => {
    const { sku, recipe, date, qty } = item;
    const hours = recipe.brewHours || 2;

    // Вместимость ОДНОГО реактора по рецептуре (шт). Если введённое количество
    // больше — делим на несколько полных партий вместо того, чтобы закладывать
    // весь объём в один реактор. Последняя партия получает остаток.
    const unitsPerBatch = Math.floor((recipe.baseBatch || 0) / (recipe.tara || 1));
    const canSplit = Number.isFinite(unitsPerBatch) && unitsPerBatch > 0 && qty > unitsPerBatch;
    const numBatches = canSplit ? Math.ceil(qty / unitsPerBatch) : 1;

    const batchIds = [];
    if (!runningLoadsByDate[date]) runningLoadsByDate[date] = {};

    for (let i = 0; i < numBatches; i++) {
      const chunkQty = canSplit
        ? (i < numBatches - 1 ? unitsPerBatch : qty - unitsPerBatch * (numBatches - 1))
        : qty;
      const volume = Math.round(chunkQty * recipe.tara * 10) / 10;

      const reactor = autoAssignReactor(date, hours, runningLoadsByDate[date]);
      // autoAssignReactor уже добавил `hours` в runningLoadsByDate[date][reactor] —
      // итоговая нагрузка = существующие сохранённые партии + всё виртуально назначенное в этом проходе
      const totalLoadAfter = getReactorDayLoad(reactor, date, null) + runningLoadsByDate[date][reactor];
      if (totalLoadAfter > state.workdayHours) {
        conflicts.push(`${recipe.name} на ${fmtDateHuman(date)} (${reactor})${numBatches > 1 ? ` [${i+1}/${numBatches}]` : ''}`);
      }

      const priority = 3; // обычный приоритет для плановых партий недели
      const batch = mkBatch({
        sku, volume, tara: recipe.tara, reactor, priority, status: 'planned',
        brewDate: date, brewHours: hours,
        note: numBatches > 1 ? `Недельный план · сводная варка · реактор ${i+1}/${numBatches}` : `Недельный план · сводная варка`,
        weekPlanSource: { weekStart: state.wpWeekStart, sku, date }
      });
      state.batches.push(batch);
      batchIds.push(batch.id);
      createdCount++;
    }

    if (!state.wpGenerated[state.wpWeekStart]) state.wpGenerated[state.wpWeekStart] = {};
    if (!state.wpGenerated[state.wpWeekStart][sku]) state.wpGenerated[state.wpWeekStart][sku] = {};
    state.wpGenerated[state.wpWeekStart][sku][date] = { batchIds, qty };
  });

  // Остаток склада НЕ трогаем автоматически: он вносится только вручную (wpSetStock).
  // Раньше здесь сваренное прибавлялось к stockLevels — по требованию убрано.

  // спрос и план варки НЕ очищаем — пользователь должен видеть
  // полную картину: заказы и план рядом со сформированными партиями.

  saveState();
  renderWeekPlan();
  render();

  if (conflicts.length) {
    showToast(`Создано ${createdCount} варок. Превышение буфера: ${conflicts.length} шт.`);
  } else {
    showToast(`Сформировано ${createdCount} варок · реакторы назначены автоматически`);
  }
}

function wpSetStock(sku, qty) {
  state.stockLevels[sku] = qty;
  saveState();
  renderWeekPlan();
}

function openSelectWpClientsModal() {
  const el = document.getElementById('wp-clients-toggle-list');
  el.innerHTML = state.clients.map(c => {
    const checked = state.wpClients.includes(c);
    return `<div class="role-field-row">
      <span>${c}</span>
      <div class="toggle ${checked?'on':''}" onclick="toggleWpClient('${c}', this)"></div>
    </div>`;
  }).join('');
  document.getElementById('modal-wp-clients').classList.add('open');
}
function toggleWpClient(client, el) {
  const idx = state.wpClients.indexOf(client);
  if (idx >= 0) state.wpClients.splice(idx, 1);
  else state.wpClients.push(client);
  if (el) el.classList.toggle('on');
  saveState();
  renderWeekPlan();
}

function openSelectWpProductsModal() {
  const el = document.getElementById('wp-products-toggle-list');
  el.innerHTML = state.recipes.map(r => {
    const checked = r.activeInPlan !== false;
    return `<div class="role-field-row">
      <span>${r.name}</span>
      <div class="toggle ${checked?'on':''}" onclick="toggleWpProductModal('${r.sku}', this)"></div>
    </div>`;
  }).join('');
  document.getElementById('modal-wp-products').classList.add('open');
}
function toggleWpProductModal(sku, el) {
  const r = state.recipes.find(x => x.sku === sku);
  if (!r) return;
  const newActive = !(r.activeInPlan !== false); // toggle current visible state
  r.activeInPlan = newActive;
  el.classList.toggle('on');
  saveState();
  renderWeekPlan();
}

function openUpdateStockModal() {
  const el = document.getElementById('stock-input-list');
  el.innerHTML = state.recipes.map(r => `
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="flex:1; font-size:13px;">${r.name}</span>
      <input type="number" id="stock-modal-${r.sku}" value="${state.stockLevels[r.sku] || ''}" placeholder="0" min="0" style="width:90px; text-align:center;" />
    </div>`).join('');
  document.getElementById('modal-stock').classList.add('open');
}
function saveStockLevels() {
  state.recipes.forEach(r => {
    const inp = document.getElementById(`stock-modal-${r.sku}`);
    if (inp) state.stockLevels[r.sku] = parseFloat(inp.value) || 0;
  });
  saveState();
  closeModal('modal-stock');
  renderWeekPlan();
  showToast('Остатки склада обновлены');
}

// ════════════════════════════════════════════════════════════════════════════
// ЗАЯВКИ
// ════════════════════════════════════════════════════════════════════════════
function renderRequests() {
  const el = document.getElementById('requests-list');
  if (!el) return;
  let reqs = [...state.requests];
  if (state.filterRequestStatus !== 'all') reqs = reqs.filter(r => r.status === state.filterRequestStatus);
  reqs.sort((a,b) => new Date(a.brewDate) - new Date(b.brewDate));

  if (!reqs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-title">Нет заявок</div><div>Заявки формируются автоматически из недельного плана</div></div>`;
    return;
  }

  el.innerHTML = reqs.map(req => {
    const prog = requestProgress(req);
    const pct = prog.totalPlan ? Math.round(prog.totalFact / prog.totalPlan * 100) : 0;
    const itemsText = req.items.map(i => `${i.name} × ${i.qty} шт`).join(', ');
    return `<div class="card">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div class="client-badge">${req.client.charAt(0).toUpperCase()}</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-size:15px; font-weight:700;">${req.client}</span>
            <span style="font-size:12px; color:var(--text2);">${req.id}</span>
            <span class="status-dot dot-${req.status}" style="display:inline-block;"></span>
            <span class="s-${req.status}" style="font-size:12px; font-weight:700;">${statusLabel(req.status)}</span>
          </div>
          <div style="font-size:13px; color:var(--text); margin-top:4px;">${itemsText}</div>
          <div class="batch-meta" style="margin-top:6px;">
            <span>Заявка: ${fmtDateHuman(req.date)}</span>
            <span>Варка: ${fmtDateHuman(req.brewDate)} · ${req.brewHours}ч</span>
            <span>Отгрузка: ${fmtDateHuman(req.shipDate)}</span>
            <span>${req.reactor}</span>
          </div>
          <div class="progress-bar-wrap" style="margin-top:8px;">
            <div class="progress-bar" style="width:${pct}%; background:${pct>=100?'var(--accent2)':'var(--accent)'};"></div>
          </div>
          <div style="font-size:12px; color:var(--text2); margin-top:4px;">Сварено: ${prog.totalFact} из ${prog.totalPlan} шт (${pct}%)</div>
        </div>
        ${req.status==='ready' ? `<button class="btn btn-success btn-sm" onclick="markShipped('${req.id}')">Отгрузить</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function filterRequests(status, btn) {
  state.filterRequestStatus = status;
  document.querySelectorAll('#page-requests .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRequests();
}

function markShipped(id) {
  const req = state.requests.find(r => r.id === id);
  if (req) { req.status = 'shipped'; saveState(); render(); showToast(`Заявка ${id} отгружена`); }
}

// ════════════════════════════════════════════════════════════════════════════
// OPERATOR — план варки (прямые варки)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// WARSHCHIK
// ════════════════════════════════════════════════════════════════════════════
function warshchikShiftDay(delta) {
  state.warshchikViewingHistory = true;
  state.warshchikViewDate = fmtDate(addDays(new Date(state.warshchikViewDate), delta));
  saveState();
  renderWarshchikBatches();
}
function warshchikGoToDate(iso) {
  if (!iso) return;
  state.warshchikViewingHistory = true;
  state.warshchikViewDate = iso;
  saveState();
  renderWarshchikBatches();
}
function warshchikGoToday() {
  state.warshchikViewingHistory = false; // возвращаемся к стандартному правилу "сегодня + просрочка"
  state.warshchikViewDate = fmtDate(new Date());
  saveState();
  renderWarshchikBatches();
}

function renderWarshchikBatches() {
  const el = document.getElementById('warshchik-batches');
  if (!el) return;
  const today = fmtDate(new Date());

  // В терминале оператора варки вкладки реакторов скрыты — фильтр по реактору
  // не должен «залипать» (иначе назначенные задания не отображаются, а сбросить
  // фильтр нечем). Всегда показываем все реакторы.
  if (isBrewOperatorRole() && state.filterReactor !== 'all') state.filterReactor = 'all';

  const currentRoleForNav = getRoleById(currentUser.roleId);
  // Оператор варки — без выбора даты вообще (только сегодня). Для остальных — по настройке роли.
  const showDateNav = isBrewOperatorRole() ? false
    : (!currentRoleForNav || currentRoleForNav.fields.dateNavWarshchik !== false);
  const dateNavEl = document.getElementById('warshchik-date-nav');
  if (dateNavEl) dateNavEl.style.display = showDateNav ? 'flex' : 'none';
  // если выбор даты скрыт админом, принудительно возвращаем обычный режим — нельзя
  // оставаться в "истории" без возможности самостоятельно выйти из неё
  if (!showDateNav && state.warshchikViewingHistory) {
    state.warshchikViewingHistory = false;
    state.warshchikViewDate = fmtDate(new Date());
  }

  const picker = document.getElementById('warshchik-date-picker');
  if (picker) picker.value = state.warshchikViewDate;
  updateDateNavUI('warshchik-date-human', 'warshchik-today-btn', state.warshchikViewDate);
  const dateLabel = document.getElementById('warshchik-date-label');

  let batches, overdueCount = 0, headerNote = '';

  if (state.warshchikViewingHistory) {
    // Просмотр конкретного дня вручную — показываем всё, что было назначено на эту дату,
    // независимо от статуса, без логики "просрочка" (это история, не текущая работа).
    if (dateLabel) dateLabel.textContent = '';
    batches = state.batches.filter(b => b.brewDate === state.warshchikViewDate && b.status !== 'deleted' && b.status !== 'cancelled' && b.sentToBrewing);
    if (state.filterReactor !== 'all') batches = batches.filter(b => b.reactor === state.reactors[parseInt(state.filterReactor)-1]);
    batches.sort((a,b) => a.priority - b.priority);
  } else {
    // СТРОГО только сегодня + просроченные (не сваренные вовремя) — чтобы задача не "терялась".
    // Партии, которые главный оператор ещё не передал в варку («В очереди»), сюда не попадают.
    if (dateLabel) dateLabel.textContent = '';
    batches = state.batches.filter(b =>
      (b.status === 'active' || b.status === 'planned') &&
      b.brewDate <= today && b.sentToBrewing
    );
    if (state.filterReactor !== 'all') batches = batches.filter(b => b.reactor === state.reactors[parseInt(state.filterReactor)-1]);
    batches.sort((a,b) => {
      const aOverdue = a.brewDate < today, bOverdue = b.brewDate < today;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1; // overdue first
      return a.priority - b.priority || new Date(a.brewDate) - new Date(b.brewDate);
    });
    overdueCount = batches.filter(b => b.brewDate < today).length;
    headerNote = overdueCount
      ? `<div class="note note-danger" style="margin-bottom:12px;">${overdueCount} парти${overdueCount===1?'я':'и'} просрочено — не сварено в назначенный день</div>`
      : '';
  }

  // Оператор варки видит только СВОИ задачи (assignedBrewingOperatorRoleId).
  const viewerRole = getRoleById(currentUser.roleId);
  const isDedicatedBrewOp = viewerRole && !viewerRole.fullAccess
    && viewerRole.tabs && viewerRole.tabs.length === 1 && viewerRole.tabs[0] === 'warshchik';

  // reactor tabs — вся плашка реактора закрашивается/пульсирует цветом статуса.
  // Для оператора варки: статус смысловой (Свободен/Назначена/Варится/Сварено),
  // а тап по реактору ОТКРЫВАЕТ задание (а не фильтрует список).
  const tabsEl = document.getElementById('reactor-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = state.reactors.map((r,i) => {
        const ind = isDedicatedBrewOp ? brewReactorState(r) : reactorIndicatorState(r);
        // У оператора варки бейдж считает только релевантные задачи (назначена/варится),
        // чтобы цифра совпадала со статусом «Свободен» (иначе на свободном висела «1»).
        const countToday = isDedicatedBrewOp
          ? state.batches.filter(b => b.reactor === r && b.brewDate <= today && (b.assignedToBrewing || b.sentToBrewing) && b.status !== 'done' && b.status !== 'cancelled' && b.status !== 'deleted').length
          : state.batches.filter(b => b.reactor === r && b.brewDate === today && b.status !== 'cancelled' && b.status !== 'deleted').length;
        const onClick = isDedicatedBrewOp ? `openReactorTask('${r}')` : `filterReactor('${i+1}',this,event)`;
        return `<button class="reactor-card rcard-${ind.color} ${(!isDedicatedBrewOp && state.filterReactor===String(i+1))?'active':''}" onclick="${onClick}" style="position:relative;">
          ${countToday > 0 ? `<span class="rtab-count-badge">${countToday}</span>` : ''}
          <div class="reactor-card-icon">${getReactorCardIcon(ind.color)}</div>
          <div class="reactor-card-name">${r}</div>
          <div class="reactor-card-status">
            <span class="status-dot-ind status-dot-${ind.color}"></span>
            ${ind.text}
          </div>
        </button>`;
      }).join('');
  }

  if (isDedicatedBrewOp) {
    batches = batches.filter(b => !b.assignedBrewingOperatorRoleId || b.assignedBrewingOperatorRoleId === currentUser.roleId);
  }

  if (!batches.length) {
    if (state.warshchikViewingHistory) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h10"/></svg></div><div class="empty-title">Нет варок за этот день</div></div>`;
      return;
    }
    // Различаем «всё сварено» и «не назначено»: смотрим, были ли вообще задачи на сегодня
    // (включая уже сваренные) для этого оператора. Активных нет — иначе мы бы сюда не попали.
    let todays = state.batches.filter(b =>
      b.brewDate <= today && b.sentToBrewing &&
      b.status !== 'deleted' && b.status !== 'cancelled'
    );
    if (isDedicatedBrewOp) {
      todays = todays.filter(b => !b.assignedBrewingOperatorRoleId || b.assignedBrewingOperatorRoleId === currentUser.roleId);
    }
    // «всё сварено» — только если реально сварили партию сегодня (дата варки = сегодня),
    // иначе старые завершённые партии давали бы ложное «всё сварено» по умолчанию.
    const hadDoneToday = todays.some(b => b.status === 'done' && b.brewDate === today);
    const freePanelHtmlEmpty = (isDedicatedBrewOp && _brewopSelectedReactor && brewReactorState(_brewopSelectedReactor).color === 'white')
      ? `<div id="brewop-free-panel"><div style="font-size:18px; font-weight:800; color:var(--text); margin-bottom:4px;">${_brewopSelectedReactor}</div><div style="font-size:13px; color:var(--text2);">Реактор свободен · Задач на сегодня нет</div></div>`
      : '';
    el.innerHTML = freePanelHtmlEmpty + (hadDoneToday
      ? `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8,12 11,15 16,9"/></svg></div><div class="empty-title">На сегодня всё сварено</div></div>`
      : `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div class="empty-title">На сегодня варки не назначены</div></div>`);
    return;
  }
  const freePanelHtml = (isDedicatedBrewOp && _brewopSelectedReactor && brewReactorState(_brewopSelectedReactor).color === 'white')
    ? `<div id="brewop-free-panel"><div style="font-size:18px; font-weight:800; color:var(--text); margin-bottom:4px;">${_brewopSelectedReactor}</div><div style="font-size:13px; color:var(--text2);">Реактор свободен · Задач на сегодня нет</div></div>`
    : '';
  el.innerHTML = freePanelHtml + headerNote + batches.map(b => warshchikBatchCard(b, !state.warshchikViewingHistory && b.brewDate < today, isDedicatedBrewOp)).join('');
}

// Генерирует HTML сегментированного индикатора "как батарейка".
// mode: 'empty' (в очереди, не начато), 'progress' (есть % — варочный участок),
// 'running-noeta' (идёт процесс без известной длительности — розлив), 'done' (готово).
function renderBatteryIndicator(mode, pct, label) {
  const totalSegments = 5;
  const filledCount = mode === 'done' ? totalSegments
    : mode === 'progress' ? Math.round((pct||0) / 100 * totalSegments)
    : mode === 'running-noeta' ? totalSegments // все "горят" пульсацией, без точного количества
    : 0;
  const stateClass = mode === 'done' ? 'batt-done' : mode === 'progress' ? 'batt-cooking' : mode === 'running-noeta' ? 'batt-running-noeta' : 'batt-empty';
  const segmentsHtml = Array.from({length: totalSegments}, (_, i) =>
    `<div class="brew-battery-segment ${i < filledCount ? 'filled' : ''}"></div>`
  ).join('');
  return `<div class="brew-battery ${stateClass}">
    <div class="brew-battery-body">${segmentsHtml}<div class="brew-battery-tip"></div></div>
    <div class="brew-battery-label">${label}</div>
  </div>`;
}

function warshchikBatchCard(b, isOverdue, brewopMode) {
  // Упрощённая крупная карточка для терминала оператора варки
  if (brewopMode) {
    // Единая цветовая идентификация — те же цвета, что в «Управлении производством»
    const stage = getBatchStage(b);
    const color = PM_STAGE_COLORS[stage] || 'white';
    const statusText = BREWOP_STAGE_TEXT[stage] || PM_STAGE_SHORT[stage] || '';
    return `<div class="brewop-task-card${isOverdue ? ' overdue' : ''}" onclick="openZakladka('${b.id}')">
      <div class="brewop-card-body">
        <div class="brewop-card-name">${b.name}</div>
        <div class="brewop-card-meta${isOverdue ? ' overdue-text' : ''}">${isOverdue ? 'Просрочено · ' : ''}${fmtDateHuman(b.brewDate)} · ${b.brewHours}ч · ${b.volume} кг</div>
        <div class="brewop-card-status-row">
          <span class="status-dot-ind status-dot-${color}"></span>
          <span class="brewop-slabel">${statusText}</span>
        </div>
      </div>
      <div class="brewop-reactor-badge">${b.reactor}</div>
    </div>`;
  }

  const rc = reactorColor(b.reactor);
  const currentRole = getRoleById(currentUser.roleId);
  const fields = (currentRole && currentRole.fields) || {};
  const pct = getBrewProgressPct(b);
  const mode = b.status === 'done' ? 'done' : (b.status === 'active' ? 'progress' : 'empty');
  const label = b.status === 'done' ? '✓' : b.status === 'active' ? pct+'%' : b.reactor.replace('Р-','');
  const batteryHtml = renderBatteryIndicator(mode, pct, label);
  return `<div class="batch-card" onclick="openZakladka('${b.id}')" style="${isOverdue ? 'border-color:var(--danger);' : ''}" title="${b.status==='done' ? 'Готово' : b.status==='active' ? `Идёт варка · ${pct}% по времени` : 'В очереди'}">
    <div class="batch-top">
      ${batteryHtml}
      <div class="batch-info">
        <div class="batch-name">${b.name}</div>
        <div class="batch-meta">
          <span>${b.id} · <b>${b.reactor}</b></span>
          <span>${b.volume} кг → ${b.planQty} шт</span>
          <span ${isOverdue ? 'style="color:var(--danger); font-weight:700;"' : ''}>${isOverdue ? 'Просрочено · ' : ''}${fmtDateHuman(b.brewDate)} · ${b.brewHours}ч</span>
        </div>
      </div>
      ${fields.priority ? `<div style="font-size:11px; font-weight:700; color: ${['','#ef4444','#f97316','#eab308','#22c55e'][b.priority] || '#8892a4'};">${priorityLabel(b.priority)}</div>` : ''}
    </div>
    <div class="batch-status">
      <div class="status-dot dot-${b.status}"></div>
      <div class="status-label s-${b.status}">${statusLabel(b.status)}</div>
    </div>
  </div>`;
}

// Смысловой статус реактора для терминала оператора варки. В отличие от
// reactorIndicatorState не показывает розливных стадий — только то, что важно варщику.
// Возвращает { color, text, batch } — batch это задача для открытия по тапу.
function brewReactorState(reactorName) {
  const today = fmtDate(new Date());
  const rel = state.batches.filter(b =>
    b.reactor === reactorName && b.status !== 'cancelled' && b.status !== 'deleted' &&
    (b.assignedToBrewing || b.sentToBrewing) && b.brewDate <= today
  );
  const brewing = rel.find(b => b.status === 'active');
  if (brewing) return { color: 'orange', text: 'Варится', batch: brewing };
  const assigned = rel.find(b => b.status !== 'done' && b.status !== 'active');
  if (assigned) return { color: 'red', text: 'Назначена', batch: assigned };
  const brewed = rel.find(b => b.status === 'done' && getBatchStage(b) === 'brewed' && b.brewDate === today);
  if (brewed) return { color: 'blue', text: 'Сварено', batch: brewed };
  return { color: 'white', text: 'Свободен', batch: null };
}

// Тап по карточке реактора в терминале варщика — открыть задание на нём.
function openReactorTask(reactorName) {
  const st = brewReactorState(reactorName);
  if (st.batch) {
    _brewopSelectedReactor = null;
    openZakladka(st.batch.id);
  } else {
    // Свободный реактор — показываем панель снизу (toggle при повторном тапе)
    _brewopSelectedReactor = (_brewopSelectedReactor === reactorName) ? null : reactorName;
    // Подсветка выбранной карточки
    document.querySelectorAll('#reactor-tabs .reactor-card').forEach(btn => {
      btn.classList.toggle('brewop-selected', btn.getAttribute('onclick') === `openReactorTask('${_brewopSelectedReactor}')`);
    });
    renderWarshchikBatches();
  }
}

function getReactorCardIcon(color) {
  const s = 'width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  if (color === 'white') return `<svg ${s} class="rci rci-modules"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>`;
  if (color === 'orange') return `<svg ${s} class="rci rci-tank"><path d="M6 3h12l1 4H5L6 3z"/><rect x="4" y="7" width="16" height="11" rx="2"/><path d="M4 12h16"/><circle cx="9" cy="15.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="15.5" r="1" fill="currentColor" stroke="none"/><path d="M8 18v3m8-3v3"/></svg>`;
  if (color === 'blue') return `<svg ${s} class="rci"><circle cx="12" cy="12" r="9"/><path class="rci-clock-hand" d="M12 7v5l3 2"/></svg>`;
  if (color === 'green') return `<svg ${s} class="rci rci-bottles"><rect x="1" y="3" width="22" height="2" rx="1"/><line x1="6" y1="5" x2="6" y2="8"/><line x1="12" y1="5" x2="12" y2="8"/><line x1="18" y1="5" x2="18" y2="8"/><path d="M4.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M10.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M16.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><rect x="1" y="19" width="22" height="3" rx="1.5"/><circle cx="5" cy="20.5" r="1.5"/><circle cx="19" cy="20.5" r="1.5"/></svg>`;
  if (color === 'red') return `<svg ${s} class="rci"><path d="M4 3v18"/><path class="rci-flag-body" d="M4 3h14l-4 6 4 6H4"/></svg>`;
  return `<svg ${s} class="rci rci-pause"><circle cx="12" cy="12" r="9"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/></svg>`;
}

let _reactorDeselectTimer = null;
let _brewopSelectedReactor = null;
function filterReactor(r, btn, ev) {
  if (ev) ev.stopPropagation();
  if (_reactorDeselectTimer) { clearTimeout(_reactorDeselectTimer); _reactorDeselectTimer = null; }
  state.filterReactor = (state.filterReactor === r) ? 'all' : r;
  if (state.filterReactor !== 'all') {
    _reactorDeselectTimer = setTimeout(() => {
      _reactorDeselectTimer = null;
      state.filterReactor = 'all';
      renderWarshchikBatches();
      renderReactorInfoPanel();
    }, 7000);
  }
  renderWarshchikBatches();
  renderReactorInfoPanel();
}

function renderReactorInfoPanel() {
  const panel = document.getElementById('reactor-info-panel');
  if (!panel) return;
  if (!state.filterReactor || state.filterReactor === 'all') {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }
  const rName = state.reactors[parseInt(state.filterReactor) - 1];
  if (!rName) { panel.style.display = 'none'; return; }
  const viewDate = state.warshchikViewDate || fmtDate(new Date());
  const rBatches = state.batches.filter(b => b.reactor === rName && b.brewDate === viewDate && b.status !== 'cancelled' && b.status !== 'deleted');
  if (!rBatches.length) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  panel.innerHTML = rBatches.map(b => {
    const stage = getBatchStage(b);
    const stageLabel = { queued:'В очереди', brewing:'Идёт варка', brewed:'Варка завершена', pouring:'Идёт розлив', poured:'Розлив завершён', finished:'Готово' }[stage] || stage;
    const stageColor = { queued:'var(--text3)', brewing:'var(--warn)', brewed:'var(--accent)', pouring:'var(--accent2)', poured:'var(--accent2)', finished:'var(--accent2)' }[stage] || 'var(--text2)';
    const pct = (stage === 'brewing') ? getBrewProgressPct(b) : null;
    return `<div class="card" style="padding:12px 16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
      <div style="flex:1; min-width:160px;">
        <div style="font-weight:700; font-size:14px;">${b.name}</div>
        <div class="batch-meta" style="margin-top:4px;">
          <span>${b.id}</span>
          <span>${b.volume} кг</span>
          <span>${fmtDateHuman(b.brewDate)}</span>
          ${b.pouringLine ? `<span>Линия: ${b.pouringLine}</span>` : ''}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
        ${pct !== null ? `<div style="font-size:12px; color:var(--text2);">Прогресс: <strong style="color:var(--warn);">${pct}%</strong></div>` : ''}
        <div style="font-size:12px; font-weight:700; color:${stageColor};">${stageLabel}</div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// ПРИЁМКА ВЫХОДА — варки готовы, но факт выхода (шт) ещё не введён
// ════════════════════════════════════════════════════════════════════════════
function intakeShiftDay(delta) {
  state.intakeShowAll = false;
  state.intakeDate = fmtDate(addDays(new Date(state.intakeDate), delta));
  saveState();
  renderIntake();
}
function intakeGoToDate(iso) {
  if (!iso) return;
  state.intakeShowAll = false;
  state.intakeDate = iso;
  saveState();
  renderIntake();
}
function intakeGoToday() {
  state.intakeShowAll = true; // "Сегодня" здесь означает "вся текущая очередь ожидания", без жёсткого фильтра по дате варки
  state.intakeDate = fmtDate(new Date());
  saveState();
  renderIntake();
}

function renderIntake() {
  const el = document.getElementById('intake-list');
  if (!el) return;
  const canAct = canActOnPage('intake');

  // В терминале оператора розлива вкладки линий скрыты — фильтр по линии не должен
  // «залипать» (иначе задания не отображаются, а сбросить нечем).
  if (isPourOperatorRole() && state.filterPouringLine && state.filterPouringLine !== 'all') state.filterPouringLine = 'all';

  const currentRoleForNav = getRoleById(currentUser.roleId);
  // Оператор розлива — без выбора даты вообще (только сегодня), симметрично варщику. Для остальных — по настройке роли.
  const showDateNav = isPourOperatorRole() ? false
    : (!currentRoleForNav || currentRoleForNav.fields.dateNavIntake !== false);
  const dateNavEl = document.getElementById('intake-date-nav');
  if (dateNavEl) dateNavEl.style.display = showDateNav ? 'flex' : 'none';
  // если выбор даты скрыт админом, принудительно показываем всю очередь —
  // иначе пользователь мог остаться "заперт" на фильтре конкретного дня без способа выйти
  if (!showDateNav && !state.intakeShowAll) {
    state.intakeShowAll = true;
  }

  const picker = document.getElementById('intake-date-picker');
  if (picker) picker.value = state.intakeDate;
  updateDateNavUI('intake-date-human', 'intake-today-btn', state.intakeDate);

  // в очередь розлива попадают варки, готовые с варочного участка (done), у которых
  // ещё нет фактического количества штук, которым уже назначена линия розлива,
  // и которые главный оператор явно передал в розлив (sentToPouring) — партии без
  // этого видны только главному оператору в «Управлении производством»
  let pending = state.batches.filter(b => b.status === 'done' && (b.factQty === null || b.factQty === undefined) && b.pouringLine && b.sentToPouring);
  // если партия закреплена за конкретным оператором-ролью — её видит только он;
  // это ограничение касается только самих операторов розлива — главный оператор/админ
  // в режиме наблюдения видят всё, независимо от назначения
  if (canAct) {
    pending = pending.filter(b => !b.assignedOperatorRoleId || b.assignedOperatorRoleId === currentUser.roleId);
  }
  // видимость день-в-день — по дате РОЗЛИВА, а не дате варки
  if (!state.intakeShowAll) pending = pending.filter(b => (b.pouringDate || b.brewDate) === state.intakeDate);

  // вкладки-фильтры по линиям — вся плашка закрашивается/пульсирует цветом статуса,
  // сверху статичный кружок-счётчик с количеством партий на сегодня
  const lineTabsEl = document.getElementById('intake-line-tabs');
  if (lineTabsEl) {
    const todayForLines = fmtDate(new Date());
    if (!state.filterPouringLine) state.filterPouringLine = 'all';
    lineTabsEl.innerHTML = state.pouringLines.map(l => {
        const ind = lineIndicatorState(l);
        const countToday = state.batches.filter(b => b.pouringLine === l && b.status !== 'cancelled' && b.status !== 'deleted' && !['poured','finished'].includes(getBatchStage(b))).length;
        const shortName = l.replace('Линия ', 'Л-');
        return `<button class="reactor-card rcard-${ind.color} ${state.filterPouringLine===l?'active':''}" onclick="filterPouringLine('${l}',this,event)" style="position:relative;">
          ${countToday > 0 ? `<span class="rtab-count-badge">${countToday}</span>` : ''}
          <div class="reactor-card-icon">${getLineCardIcon(ind.color)}</div>
          <div class="reactor-card-name">${shortName}</div>
          <div class="reactor-card-status">
            <span class="status-dot-ind status-dot-${ind.color}"></span>
            ${ind.text}
          </div>
        </button>`;
      }).join('');
  }
  if (state.filterPouringLine && state.filterPouringLine !== 'all') {
    pending = pending.filter(b => b.pouringLine === state.filterPouringLine);
  }

  pending.sort((a,b) => new Date(a.pouringDate || a.brewDate) - new Date(b.pouringDate || b.brewDate));

  if (!pending.length) {
    const checkIcon = `<div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8,12 11,15 16,9"/></svg></div>`;
    const waitIcon = `<div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8,12 11,15 16,9"/></svg></div>`;
    if (isPourOperatorRole()) {
      // Терминал оператора розлива — формулировки про розлив, без выбора даты
      el.innerHTML = `<div class="empty-state">${checkIcon}<div class="empty-title">Нет заданий на розлив</div><div>Все переданные партии разлиты</div></div>`;
    } else {
      el.innerHTML = state.intakeShowAll
        ? `<div class="empty-state">${checkIcon}<div class="empty-title">Нет варок, ожидающих приёмки</div><div>Все завершённые варки уже учтены</div></div>`
        : `<div class="empty-state">${waitIcon}<div class="empty-title">Нет варок за этот день</div><div>Нажмите «Сегодня», чтобы увидеть всю очередь ожидания</div></div>`;
    }
    return;
  }

  // Терминал оператора розлива — крупные карточки заданий с тапом в детальный экран.
  if (isPourOperatorRole()) {
    el.innerHTML = pending.map(b => {
      const st = pourTaskState(b);
      const lineShort = (b.pouringLine || '').replace('Линия ', 'Л-');
      return `<div class="brewop-task-card" onclick="openPouringTask('${b.id}')">
        <div class="brewop-card-body">
          <div class="brewop-card-name">${b.name}</div>
          <div class="brewop-card-meta">${b.id} · ${fmtDateHuman(b.pouringDate || b.brewDate)} · План: ${b.planQty} шт</div>
          <div class="brewop-card-status-row">
            <span class="status-dot-ind status-dot-${st.color}"></span>
            <span class="brewop-slabel">${st.text}</span>
          </div>
        </div>
        <div class="brewop-reactor-badge">${lineShort}</div>
      </div>`;
    }).join('');
    return;
  }

  el.innerHTML = pending.map(b => {
    const pouringRunning = b.pouringStartedAt && !b.pouringEndedAt;
    const pouringDone = b.pouringStartedAt && b.pouringEndedAt;
    const mode = pouringDone ? 'done' : pouringRunning ? 'running-noeta' : 'empty';
    const label = pouringDone ? '✓' : pouringRunning ? '~' : b.reactor.replace('Р-','');
    const batteryHtml = renderBatteryIndicator(mode, 0, label);

    let actionHtml;
    if (!canAct) {
      // режим наблюдения — главный оператор/админ видят статус, но не могут действовать
      const statusText = pouringDone ? 'Розлив завершён' : pouringRunning ? 'Розлив идёт' : 'Ожидает начала розлива';
      actionHtml = `<div style="font-size:13px; font-weight:700; color:var(--text2);">${statusText}</div>`;
    } else if (!b.pouringStartedAt) {
      actionHtml = `<button class="btn btn-primary btn-sm" onclick="startPouring('${b.id}')">Начать розлив</button>`;
    } else if (pouringRunning) {
      actionHtml = `<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
        <div id="pouring-timer-${b.id}" style="font-size:12px; color:var(--accent); font-weight:700;"></div>
        <button class="btn btn-danger btn-sm" onclick="stopPouring('${b.id}')">Завершить</button>
      </div>`;
    } else {
      const durationStr = formatDuration(new Date(b.pouringEndedAt) - new Date(b.pouringStartedAt));
      actionHtml = `<div style="display:flex; align-items:center; gap:8px;">
        <input type="number" id="intake-qty-${b.id}" class="ing-fact-input" oninput="reflectIntakeQtyState(this)" placeholder="${b.planQty}" style="width:100px; font-size:16px; font-weight:700; text-align:center;" />
        <button class="btn btn-success btn-sm" onclick="saveIntakeQty('${b.id}')">Принять</button>
      </div>`;
    }

    return `<div class="card">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        ${batteryHtml}
        <div style="flex:1; min-width:0;">
          <div style="font-size:15px; font-weight:700;">${b.name}</div>
          <div class="batch-meta" style="margin-top:4px;">
            <span>${b.id}</span>
            <span>${b.volume} кг</span>
            <span>${fmtDateHuman(b.pouringDate || b.brewDate)}</span>
            <span>План: <strong>${b.planQty} шт</strong></span>
            <span>Линия: ${b.pouringLine}</span>
            ${b.pouringOperatorName ? `<span>Оператор: ${b.pouringOperatorName}</span>` : ''}
            ${b.pouringStartedAt ? `<span>Начат: ${new Date(b.pouringStartedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span>` : ''}
            ${pouringDone ? `<span>Завершён: ${new Date(b.pouringEndedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})} · Заняло: ${formatDuration(new Date(b.pouringEndedAt) - new Date(b.pouringStartedAt))}</span>` : ''}
          </div>
          ${b.commentForPouring ? `<div class="note" style="margin-top:6px; border-color:var(--accent);">💬 Комментарий от главного оператора: ${b.commentForPouring}</div>` : ''}
        </div>
        <div style="flex-shrink:0;">${actionHtml}</div>
      </div>
    </div>`;
  }).join('');
}

function getLineCardIcon(color) {
  const s = 'width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  if (color === 'white') return `<svg ${s} class="rci rci-conveyor"><rect x="2" y="9" width="20" height="6" rx="3"/><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M8 12h5m0 0l-2-2m2 2l-2 2" class="rci-conveyor-arrow"/></svg>`;
  if (color === 'green') return `<svg ${s} class="rci rci-bottles"><rect x="1" y="3" width="22" height="2" rx="1"/><line x1="6" y1="5" x2="6" y2="8"/><line x1="12" y1="5" x2="12" y2="8"/><line x1="18" y1="5" x2="18" y2="8"/><path d="M4.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M10.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><path d="M16.5 8h3v2.5l.5.5v7h-4v-7l.5-.5V8z"/><rect x="1" y="19" width="22" height="3" rx="1.5"/><circle cx="5" cy="20.5" r="1.5"/><circle cx="19" cy="20.5" r="1.5"/></svg>`;
  if (color === 'red') return `<svg ${s} class="rci"><path d="M4 3v18"/><path class="rci-flag-body" d="M4 3h14l-4 6 4 6H4"/></svg>`;
  if (color === 'yellow') return `<svg ${s} class="rci rci-lock"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/></svg>`;
  return `<svg ${s} class="rci rci-pause"><circle cx="12" cy="12" r="9"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/></svg>`;
}

let _lineDeselectTimer = null;
function filterPouringLine(line, btn, ev) {
  if (ev) ev.stopPropagation();
  if (_lineDeselectTimer) { clearTimeout(_lineDeselectTimer); _lineDeselectTimer = null; }
  state.filterPouringLine = (state.filterPouringLine === line && line !== 'all') ? 'all' : line;
  if (state.filterPouringLine !== 'all') {
    _lineDeselectTimer = setTimeout(() => {
      _lineDeselectTimer = null;
      state.filterPouringLine = 'all';
      renderIntake();
      renderPouringLineInfoPanel();
    }, 7000);
  }
  renderIntake();
  renderPouringLineInfoPanel();
}

function renderPouringLineInfoPanel() {
  const panel = document.getElementById('pouring-line-info-panel');
  if (!panel) return;
  const line = state.filterPouringLine;
  if (!line || line === 'all') { panel.style.display = 'none'; panel.innerHTML = ''; return; }

  const lBatches = state.batches.filter(b =>
    b.pouringLine === line &&
    b.status !== 'cancelled' && b.status !== 'deleted' &&
    !['poured','finished'].includes(getBatchStage(b))
  );
  if (!lBatches.length) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  panel.innerHTML = lBatches.map(b => {
    const pouringRunning = b.pouringStartedAt && !b.pouringEndedAt;
    const pouringDone = b.pouringStartedAt && b.pouringEndedAt;
    const stageLabel = pouringDone ? 'Розлив завершён' : pouringRunning ? 'Идёт розлив' : 'Ожидает начала';
    const stageColor = pouringDone ? 'var(--accent2)' : pouringRunning ? 'var(--accent2)' : 'var(--text2)';
    return `<div class="card" style="padding:12px 16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
      <div style="flex:1; min-width:160px;">
        <div style="font-weight:700; font-size:14px;">${b.name}</div>
        <div class="batch-meta" style="margin-top:4px;">
          <span>${b.id}</span>
          <span>${b.volume} кг</span>
          <span>${fmtDateHuman(b.pouringDate || b.brewDate)}</span>
          <span>Линия: ${b.pouringLine}</span>
          <span>План: <strong>${b.planQty} шт</strong></span>
          ${b.pouringOperatorName ? `<span>Оператор: ${b.pouringOperatorName}</span>` : ''}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
        ${pouringRunning ? `<div style="font-size:12px; color:var(--text2);">Начат: <strong style="color:var(--accent);">${new Date(b.pouringStartedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</strong></div>` : ''}
        ${pouringDone && b.factQty ? `<div style="font-size:12px; color:var(--text2);">Факт: <strong style="color:var(--accent2);">${b.factQty} шт</strong></div>` : ''}
        <div style="font-size:12px; font-weight:700; color:${stageColor};">${stageLabel}</div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// ТЕРМИНАЛ ОПЕРАТОРА РОЗЛИВА — детальный экран задания (по аналогии с варкой)
// ════════════════════════════════════════════════════════════════════════════

// Смысловой статус задания розлива: ожидает начала / идёт / введите количество.
// Цвета согласованы с общей идентификацией (red=нужно действие, orange=в процессе, blue=почти готово).
function pourTaskState(b) {
  if (!b.pouringStartedAt) return { color: 'red', text: 'Ожидает розлива' };
  if (!b.pouringEndedAt)   return { color: 'orange', text: 'Идёт розлив' };
  return { color: 'blue', text: 'Введите количество' };
}

function openPouringTask(id) {
  const b = getBatchById(id);
  if (!b) return;
  state.currentPouringId = id;
  document.getElementById('intake-list').style.display = 'none';
  const detail = document.getElementById('intake-detail');
  detail.style.display = 'block';
  renderPouringDetail(b);
  if (isPourOperatorRole()) {
    document.body.classList.add('terminal-detail-open');
    history.pushState({ terminalTask: id }, '');
  }
}

function backToIntakeList() {
  state.currentPouringId = null;
  document.body.classList.remove('terminal-detail-open');
  const detail = document.getElementById('intake-detail');
  if (detail) detail.style.display = 'none';
  const list = document.getElementById('intake-list');
  if (list) list.style.display = 'block';
  render();
}

function renderPouringDetail(b) {
  const detail = document.getElementById('intake-detail');
  if (!detail) return;
  const canAct = canActOnPage('intake');
  const st = pourTaskState(b);
  const running = b.pouringStartedAt && !b.pouringEndedAt;
  const ended = b.pouringStartedAt && b.pouringEndedAt;

  // Однокнопочный поток
  let actionHtml;
  if (!canAct) {
    actionHtml = `<div style="font-size:15px; font-weight:800; color:var(--text2); text-align:center;">${st.text}</div>`;
  } else if (!b.pouringStartedAt) {
    actionHtml = `<button class="btn btn-primary btn-full" onclick="startPouring('${b.id}')">Начать розлив</button>`;
  } else if (running) {
    actionHtml = `<div id="pouring-timer-${b.id}" style="font-size:14px; color:var(--accent); font-weight:700; text-align:center; margin-bottom:10px;"></div>
      <button class="btn btn-danger btn-full" onclick="stopPouring('${b.id}')">Завершить розлив</button>`;
  } else {
    // ended, ждём ввода факта
    const durationStr = formatDuration(new Date(b.pouringEndedAt) - new Date(b.pouringStartedAt));
    actionHtml = `<div style="font-size:13px; color:var(--text2); text-align:center; margin-bottom:10px;">Розлив занял ${durationStr} · введите фактический выход (шт)</div>
      <div style="display:flex; gap:8px;">
        <input type="number" id="intake-qty-${b.id}" class="ing-fact-input" oninput="reflectIntakeQtyState(this)" placeholder="${b.planQty}" style="flex:1; font-size:20px; padding:12px;">
        <button class="btn btn-success" onclick="saveIntakeQty('${b.id}')" style="flex-shrink:0; padding:0 20px;">Принять</button>
      </div>`;
  }

  detail.innerHTML = `
    <div class="detail-header">
      <div class="detail-batch-num">${b.id} · ${fmtDateHuman(b.pouringDate || b.brewDate)} · ${b.pouringLine}</div>
      <div class="detail-product">${b.name}</div>
      <div class="detail-meta">
        <div class="detail-meta-item">Объём: <span>${b.volume} кг</span></div>
        <div class="detail-meta-item">Тара: <span>${b.tara} л</span></div>
        <div class="detail-meta-item">Выход план: <span>${b.planQty} шт</span></div>
        <div class="detail-meta-item">Реактор: <span>${b.reactor}</span></div>
        ${b.pouringStartedAt ? `<div class="detail-meta-item">Начат: <span>${new Date(b.pouringStartedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>` : ''}
        ${ended ? `<div class="detail-meta-item">Завершён: <span>${new Date(b.pouringEndedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></div>` : ''}
      </div>
      ${b.commentForPouring ? `<div class="note" style="margin-top:8px; border-color:var(--accent);">💬 Комментарий от главного оператора: ${b.commentForPouring}</div>` : ''}
      <div class="brewop-card-status-row" style="margin-top:10px;">
        <span class="status-dot-ind status-dot-${st.color}"></span>
        <span class="brewop-slabel">${st.text}</span>
      </div>
    </div>

    <div class="card" style="text-align:center;">
      ${actionHtml}
    </div>
  `;

  updatePouringTimerDisplay(b);
}

function updatePouringTimerDisplay(b) {
  if (!b || !b.pouringStartedAt || b.pouringEndedAt) return;
  const el = document.getElementById(`pouring-timer-${b.id}`);
  if (el) el.textContent = `Идёт: ${formatDuration(new Date() - new Date(b.pouringStartedAt))}`;
}

function startPouring(batchId) {
  if (!canDo('startPouring')) { showToast('Недостаточно прав'); return; }
  if (!getBatchById(batchId)) return;
  const role = getRoleById(currentUser.roleId);
  const operatorName = role ? role.login : null;
  performCriticalBatchWrite(batchId, b => {
    b.pouringOperatorName = operatorName || b.pouringOperatorName || null;
    b.pouringStartedAt = new Date().toISOString();
  }, {
    onSuccess: (b) => {
      logActivity('Розлив начат', { target: b.id, after: { operator: b.pouringOperatorName, startedAt: b.pouringStartedAt } });
      if (state.currentPouringId === batchId) renderPouringDetail(b);
      showToast(`Розлив ${batchId} начат`);
    }
  });
}

function stopPouring(batchId) {
  if (!canDo('stopPouring')) { showToast('Недостаточно прав'); return; }
  if (!getBatchById(batchId)) return;
  performCriticalBatchWrite(batchId, b => {
    b.pouringEndedAt = new Date().toISOString();
  }, {
    onSuccess: (b) => {
      logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок розлива', page: 'production', pmStage: 'poured',
        text: `Оператор розлива завершил розлив партии ${b.id}, количество пока не введено.` });
      logActivity('Розлив завершён', { target: b.id, after: { endedAt: b.pouringEndedAt } });
      if (state.currentPouringId === batchId) renderPouringDetail(b);
      renderIntake();
      showToast(`Розлив ${batchId} завершён · введите количество`);
    }
  });
}

// Живая подсветка поля количества — та же логика, что у сырья на участке варки:
// пустое/некорректное значение — красная рамка (класс ing-fact-input:not(.filled)
// уже задаёт это в CSS), валидное число — зелёная, ещё до нажатия «Принять».
// saveIntakeQty() как и раньше не даст сохранить пустое/нулевое значение.
function reflectIntakeQtyState(input) {
  const qty = parseInt(input.value);
  input.classList.toggle('filled', !!qty && qty > 0);
}

function saveIntakeQty(batchId) {
  if (!canDo('saveIntakeQty')) { showToast('Недостаточно прав'); return; }
  const input = document.getElementById(`intake-qty-${batchId}`);
  const qty = parseInt(input.value);
  if (!qty || qty <= 0) { showToast('Введите фактический выход (шт)'); return; }
  const bCheck = getBatchById(batchId);
  if (!bCheck) return;
  performCriticalBatchWrite(batchId, b => {
    b.factQty = qty;
  }, {
    onSuccess: (b) => {
      const devForLog = ((qty - b.planQty)/b.planQty*100).toFixed(1);
      logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок розлива', page: 'production', pmStage: 'finished',
        text: `Оператор розлива завершил розлив партии ${b.id}. План: ${b.planQty} шт. Факт: ${qty} шт. Отклонение: ${devForLog > 0 ? '+' : ''}${devForLog}%.` });
      logActivity('Выход записан', { target: b.id, after: { factQty: qty, planQty: b.planQty, deviation: devForLog } });
      // Партия принята и уходит из очереди розлива — закрываем детальный экран терминала
      if (state.currentPouringId === batchId) backToIntakeList();
      renderIntake();
      render();
      showToast(`${batchId}: принято ${qty} шт · Откл.: ${devForLog > 0 ? '+' : ''}${devForLog}%`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ОТЧЁТЫ — сводка по дню: расход сырья и выход продукции, план/факт
// ════════════════════════════════════════════════════════════════════════════
function reportsShiftDay(delta) {
  state.reportsDate = fmtDate(addDays(new Date(state.reportsDate), delta));
  saveState();
  renderReports();
}
function reportsGoToDate(iso) {
  if (!iso) return;
  state.reportsDate = iso;
  saveState();
  renderReports();
}
function reportsGoToday() {
  state.reportsDate = fmtDate(new Date());
  saveState();
  renderReports();
}

// Группировка по продукту: сырьё (норма/факт) + итог выхода продукции.
// Ключевой момент: сырьё считается ОТДЕЛЬНО для каждого SKU — даже если у двух
// продуктов одинаковый компонент ("Вода деионизированная"), их расход не смешивается,
// так как для бухгалтерии важно видеть, что именно ушло именно на этот продукт.
// Общая для однодневного отчёта и отчёта за период — вход просто разный набор партий.
function aggregateIngredientsBySku(batches) {
  const bySku = {};
  batches.forEach(b => {
    if (!bySku[b.sku]) bySku[b.sku] = { name: b.name, planQty: 0, factQty: 0, hasFact: false, batches: 0, ingredients: {} };
    const entry = bySku[b.sku];
    entry.planQty += b.planQty || 0;
    if (b.factQty !== null && b.factQty !== undefined) {
      entry.factQty += b.factQty;
      entry.hasFact = true;
    }
    entry.batches++;
    (b.ingredients || []).forEach((ing, i) => {
      const key = ing.name + '|' + ing.unit;
      if (!entry.ingredients[key]) entry.ingredients[key] = { name: ing.name, unit: ing.unit, norm: 0, fact: 0, hasFact: false };
      entry.ingredients[key].norm += ing.normFact || 0;
      if (b.factIngredients && b.factIngredients[i] !== undefined) {
        entry.ingredients[key].fact += b.factIngredients[i];
        entry.ingredients[key].hasFact = true;
      }
    });
  });
  return bySku;
}

function computeReportData(viewDate) {
  // партии этого дня, исключая удалённые — отменённые тоже не считаем (нет ни расхода, ни выхода)
  const dayBatches = state.batches.filter(b => b.brewDate === viewDate && b.status !== 'deleted' && b.status !== 'cancelled');
  const doneBatches = dayBatches.filter(b => b.status === 'done');

  const totalPlanQty = doneBatches.reduce((s,b) => s + (b.planQty||0), 0);
  const totalFactQty = doneBatches.reduce((s,b) => s + (b.factQty||0), 0);
  const pendingFact = doneBatches.filter(b => b.factQty === null || b.factQty === undefined).length;
  const avgDev = totalPlanQty ? ((totalFactQty - totalPlanQty) / totalPlanQty * 100) : 0;

  const bySku = aggregateIngredientsBySku(dayBatches);

  return { dayBatches, doneBatches, totalPlanQty, totalFactQty, pendingFact, avgDev, bySku };
}

// Тот же расход сырья/выход, но за диапазон дат варки (не один день) — для сводного
// отчёта по позициям за период (§ Расход сырья за период на вкладке «Отчёты»).
function computeReportDataRange(fromDate, toDate) {
  const batches = state.batches.filter(b => b.brewDate >= fromDate && b.brewDate <= toDate
    && b.status !== 'deleted' && b.status !== 'cancelled');
  const bySku = aggregateIngredientsBySku(batches);
  return { batches, bySku };
}

function renderReports() {
  const tableEl = document.getElementById('reports-main-table');
  if (!tableEl) return;
  const viewDate = state.reportsDate || fmtDate(new Date());
  const today = fmtDate(new Date());
  const isToday = viewDate === today;

  const picker = document.getElementById('reports-date-picker');
  if (picker) picker.value = viewDate;
  updateDateNavUI('reports-date-human', 'reports-today-btn', viewDate);
  const dateLabel = document.getElementById('reports-date-label');
  if (dateLabel) dateLabel.textContent = isToday ? `Сегодня · ${fmtDateHuman(viewDate)}` : fmtDateHuman(viewDate);

  // Период для сводного отчёта по сырью — по умолчанию текущая неделя (как в
  // недельном плане), но только при первой отрисовке: не перетирать даты, если
  // пользователь уже выбрал свой диапазон.
  const rangeFromEl = document.getElementById('reports-range-from');
  const rangeToEl = document.getElementById('reports-range-to');
  if (rangeFromEl && !rangeFromEl.value) rangeFromEl.value = fmtDate(getMondayOf(new Date()));
  if (rangeToEl && !rangeToEl.value) rangeToEl.value = fmtDate(addDays(getMondayOf(new Date()), 6));

  const { dayBatches, totalPlanQty, totalFactQty, avgDev, bySku } = computeReportData(viewDate);

  const skuRows = Object.entries(bySku);
  if (!skuRows.length) {
    tableEl.innerHTML = `<div class="empty-state" style="padding:20px;"><div style="font-size:13px;">Нет варок за этот день</div></div>`;
    return;
  }

  tableEl.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:13px;">
    <thead><tr style="border-bottom:1px solid var(--border);">
      <th style="text-align:left; padding:8px 6px; color:var(--text2); font-weight:600;">Наименование</th>
      <th style="text-align:right; padding:8px 6px; color:var(--text2); font-weight:600;">План</th>
      <th style="text-align:right; padding:8px 6px; color:var(--text2); font-weight:600;">Факт</th>
      <th style="text-align:right; padding:8px 6px; color:var(--text2); font-weight:600;">Откл.</th>
    </tr></thead>
    ${skuRows.map(([sku, p]) => {
      const groupId = 'rg-' + sku.replace(/[^a-zA-Z0-9]/g, '_');
      const ingRows = Object.values(p.ingredients).sort((a,b) => b.norm - a.norm);
      const ingHtml = ingRows.map(ing => {
        const dev = ing.hasFact && ing.norm ? ((ing.fact - ing.norm) / ing.norm * 100) : null;
        const devColor = dev === null ? 'var(--text3)' : Math.abs(dev) <= 5 ? 'var(--accent2)' : 'var(--warn)';
        return `<tr class="report-group-row" data-group="${groupId}" style="border-bottom:1px solid var(--border); display:none;">
          <td style="padding:6px 6px 6px 24px; color:var(--text2);">${ing.name}</td>
          <td style="padding:6px 6px; text-align:right;">${Math.round(ing.norm*1000)/1000} ${ing.unit}</td>
          <td style="padding:6px 6px; text-align:right; color:${ing.hasFact?'var(--text)':'var(--text3)'};">${ing.hasFact ? Math.round(ing.fact*1000)/1000+' '+ing.unit : '—'}</td>
          <td style="padding:6px 6px; text-align:right; color:${devColor};">${dev !== null ? (dev>0?'+':'')+dev.toFixed(1)+'%' : '—'}</td>
        </tr>`;
      }).join('');

      const outDev = p.hasFact && p.planQty ? ((p.factQty - p.planQty) / p.planQty * 100) : null;
      const outDevColor = outDev === null ? 'var(--text3)' : Math.abs(outDev) <= 3 ? 'var(--accent2)' : 'var(--warn)';

      return `<tbody>
        <tr style="background:var(--surface2); cursor:pointer;" onclick="toggleReportGroup('${groupId}', this)">
          <td colspan="4" style="padding:10px 6px; font-weight:800; font-size:14px;">
            <span class="report-group-chevron" style="display:inline-block; margin-right:6px; transition:transform .15s; transform:rotate(-90deg);">▾</span>${p.name} <span style="font-weight:500; font-size:11px; color:var(--text2);">· ${p.batches} парт.</span>
          </td>
        </tr>
        ${ingHtml}
        <tr class="report-group-row" data-group="${groupId}" style="border-bottom:2px solid var(--border); background:rgba(16,185,129,.06); display:none;">
          <td style="padding:8px 6px; font-weight:700;">↳ Выход готовой продукции (шт)</td>
          <td style="padding:8px 6px; text-align:right; font-weight:800;">${p.planQty}</td>
          <td style="padding:8px 6px; text-align:right; font-weight:800; color:${p.hasFact?'var(--accent2)':'var(--text3)'};">${p.hasFact ? p.factQty : '—'}</td>
          <td style="padding:8px 6px; text-align:right; font-weight:800; color:${outDevColor};">${outDev !== null ? (outDev>0?'+':'')+outDev.toFixed(1)+'%' : '—'}</td>
        </tr>
      </tbody>`;
    }).join('')}
    <tfoot><tr style="border-top:2px solid var(--border);">
      <td style="padding:10px 6px; font-weight:800;">Итого выпущено за смену</td>
      <td style="padding:10px 6px; text-align:right; font-weight:800;">${totalPlanQty}</td>
      <td style="padding:10px 6px; text-align:right; font-weight:800; color:var(--accent2);">${totalFactQty}</td>
      <td style="padding:10px 6px; text-align:right; font-weight:800; color:${Math.abs(avgDev)<=3?'var(--accent2)':'var(--warn)'};">${totalPlanQty ? (avgDev>0?'+':'')+avgDev.toFixed(1)+'%' : '—'}</td>
    </tr></tfoot>
  </table>
  <div style="margin-top:8px;"><button class="btn btn-success btn-sm" onclick="exportReportToExcel()">Скачать в Excel</button></div>
  <div class="note" style="margin-top:10px;">По каждому продукту: расход сырья (норма по рецептуре / факт, который ввёл оператор варочного участка) и итоговый выход готовой продукции (план / факт, который ввёл оператор линии розлива и упаковки). Прочерк — данные ещё не введены. Кликните на название продукта, чтобы свернуть/развернуть его сырьё.</div>`;
}

function toggleReportGroup(groupId, headerRow) {
  const rows = document.querySelectorAll(`.report-group-row[data-group="${groupId}"]`);
  const chevron = headerRow.querySelector('.report-group-chevron');
  const isHidden = rows.length && rows[0].style.display === 'none';
  rows.forEach(r => {
    if (!isHidden) { r.style.display = 'none'; return; }
    // восстанавливаем правильное отображение по типу тега: <tr> — табличная строка (пусто = default),
    // <div> — flex (так как именно flex использовался для вёрстки строк сырья в Рецептурах)
    r.style.display = r.tagName === 'TR' ? '' : 'flex';
  });
  if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(-90deg)';
}

// Excel-безопасное имя листа: максимум 31 символ, без []:*?/\
function safeSheetName(name, usedNames) {
  let clean = name.replace(/[\[\]:*?\/\\]/g, '').slice(0, 31);
  if (!clean) clean = 'Лист';
  let finalName = clean;
  let counter = 2;
  while (usedNames.has(finalName)) {
    const suffix = ` (${counter})`;
    finalName = clean.slice(0, 31 - suffix.length) + suffix;
    counter++;
  }
  usedNames.add(finalName);
  return finalName;
}

function exportReportToExcel() {
  if (typeof XLSX === 'undefined') { showToast('Библиотека экспорта не загрузилась, проверьте подключение к интернету'); return; }
  const viewDate = state.reportsDate || fmtDate(new Date());
  const { dayBatches, totalPlanQty, totalFactQty, pendingFact, avgDev, bySku } = computeReportData(viewDate);

  if (!dayBatches.length) { showToast('Нет данных за этот день для экспорта'); return; }

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  // ── Лист 1: Сводка ──
  const summaryRows = [
    ['Отчёт по смене', fmtDateHuman(viewDate)],
    [],
    ['Показатель', 'Значение'],
    ['Варок за день', dayBatches.length],
    ['План выпуска (шт)', totalPlanQty],
    ['Факт выпуска (шт)', totalFactQty],
    ['Отклонение план/факт', totalPlanQty ? (avgDev>0?'+':'')+avgDev.toFixed(1)+'%' : '—'],
    ['Варок, ожидающих приёмки выхода', pendingFact],
    [],
    ['Продукт', 'Партий', 'План (шт)', 'Факт (шт)', 'Откл.'],
  ];
  Object.values(bySku).forEach(p => {
    const dev = p.hasFact && p.planQty ? ((p.factQty - p.planQty) / p.planQty * 100) : null;
    summaryRows.push([p.name, p.batches, p.planQty, p.hasFact ? p.factQty : '—', dev !== null ? (dev>0?'+':'')+dev.toFixed(1)+'%' : '—']);
  });
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{wch:32},{wch:14},{wch:14},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, summaryWs, safeSheetName('Сводка', usedNames));

  // ── Лист на каждый продукт ──
  appendIngredientSheets(wb, bySku, usedNames, p => `Дата: ${fmtDateHuman(viewDate)} · Партий: ${p.batches}`);

  downloadWorkbook(wb, `Отчёт_за_смену_${viewDate}.xlsx`);
}

// Лист на каждый продукт с расходом сырья (норма/факт/откл.) + выход готовой
// продукции — общее для однодневного отчёта и отчёта за период (см.
// exportReportToExcel / exportIngredientRangeToExcel). subtitleFn(p) даёт вторую
// строку листа (дата или период) — единственное, что у них отличается.
function appendIngredientSheets(wb, bySku, usedNames, subtitleFn) {
  Object.values(bySku).forEach(p => {
    const rows = [
      [p.name],
      [subtitleFn(p)],
      [],
      ['Компонент сырья', 'Норма', 'Факт', 'Откл.'],
    ];
    Object.values(p.ingredients).sort((a,b) => b.norm - a.norm).forEach(ing => {
      const dev = ing.hasFact && ing.norm ? ((ing.fact - ing.norm) / ing.norm * 100) : null;
      rows.push([
        ing.name,
        `${Math.round(ing.norm*1000)/1000} ${ing.unit}`,
        ing.hasFact ? `${Math.round(ing.fact*1000)/1000} ${ing.unit}` : '—',
        dev !== null ? (dev>0?'+':'')+dev.toFixed(1)+'%' : '—'
      ]);
    });
    rows.push([]);
    const outDev = p.hasFact && p.planQty ? ((p.factQty - p.planQty) / p.planQty * 100) : null;
    rows.push(['Выход готовой продукции (шт)', p.planQty, p.hasFact ? p.factQty : '—', outDev !== null ? (outDev>0?'+':'')+outDev.toFixed(1)+'%' : '—']);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:30},{wch:16},{wch:16},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(p.name, usedNames));
  });
}

function downloadWorkbook(wb, filename) {
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch(e) {
    XLSX.writeFile(wb, filename);
  }
  showToast('Файл скачан');
}

// ── Сводный отчёт по расходу сырья за произвольный период (не один день) ──
function exportIngredientRangeToExcel() {
  if (typeof XLSX === 'undefined') { showToast('Библиотека экспорта не загрузилась, проверьте подключение к интернету'); return; }
  const fromDate = document.getElementById('reports-range-from').value;
  const toDate = document.getElementById('reports-range-to').value;
  if (!fromDate || !toDate) { showToast('Укажите обе даты периода'); return; }
  if (fromDate > toDate) { showToast('Дата «с» позже даты «по»'); return; }

  const { batches, bySku } = computeReportDataRange(fromDate, toDate);
  if (!batches.length) { showToast('Нет варок за этот период'); return; }

  const doneBatches = batches.filter(b => b.status === 'done');
  const totalPlanQty = doneBatches.reduce((s,b) => s + (b.planQty||0), 0);
  const totalFactQty = doneBatches.reduce((s,b) => s + (b.factQty||0), 0);
  const avgDev = totalPlanQty ? ((totalFactQty - totalPlanQty) / totalPlanQty * 100) : 0;
  const periodLabel = `${fmtDateHuman(fromDate)} — ${fmtDateHuman(toDate)}`;

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  const summaryRows = [
    ['Расход сырья за период', periodLabel],
    [],
    ['Показатель', 'Значение'],
    ['Варок за период', batches.length],
    ['План выпуска (шт)', totalPlanQty],
    ['Факт выпуска (шт)', totalFactQty],
    ['Отклонение план/факт', totalPlanQty ? (avgDev>0?'+':'')+avgDev.toFixed(1)+'%' : '—'],
    [],
    ['Продукт', 'Партий', 'План (шт)', 'Факт (шт)', 'Откл.'],
  ];
  Object.values(bySku).forEach(p => {
    const dev = p.hasFact && p.planQty ? ((p.factQty - p.planQty) / p.planQty * 100) : null;
    summaryRows.push([p.name, p.batches, p.planQty, p.hasFact ? p.factQty : '—', dev !== null ? (dev>0?'+':'')+dev.toFixed(1)+'%' : '—']);
  });
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{wch:32},{wch:14},{wch:14},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, summaryWs, safeSheetName('Сводка', usedNames));

  appendIngredientSheets(wb, bySku, usedNames, p => `Период: ${periodLabel} · Партий: ${p.batches}`);

  downloadWorkbook(wb, `Расход_сырья_${fromDate}_${toDate}.xlsx`);
}

// ════════════════════════════════════════════════════════════════════════════
// JOURNAL
// ════════════════════════════════════════════════════════════════════════════
function journalShiftDay(delta) {
  state.journalShowAll = false;
  state.journalDate = fmtDate(addDays(new Date(state.journalDate), delta));
  saveState();
  renderJournal();
}
function journalGoToDate(iso) {
  if (!iso) return;
  state.journalShowAll = false;
  state.journalDate = iso;
  saveState();
  renderJournal();
}
function journalGoToday() {
  state.journalShowAll = false;
  state.journalDate = fmtDate(new Date());
  saveState();
  renderJournal();
}
function journalShowAll() {
  state.journalShowAll = true;
  saveState();
  renderJournal();
}

function journalFilterStatus(status, btn) {
  state.journalStatusFilter = status;
  document.querySelectorAll('#journal-status-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderJournal();
}

// Лента действий — последние записи логов (logJournalEvent), кликабельные.
function renderSystemEvents() {
  const el = document.getElementById('journal-system-list');
  if (!el) return;
  const sevFilter = state.journalSeverityFilter || null;

  // Живые алармы из computeAlarms() — всегда актуальны
  let alarms = computeAlarms();
  if (sevFilter) alarms = alarms.filter(a => a.severity === sevFilter);

  const sevColor = { critical: 'var(--danger)', warning: 'var(--warn)', info: 'var(--accent)' };
  const sevLabel = { critical: 'Критично', warning: 'Важно', info: 'Инфо' };

  if (!alarms.length) {
    const msg = sevFilter
      ? `Нет аларм категории «${sevLabel[sevFilter] || sevFilter}»`
      : 'Активных аларм нет — всё под контролем';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text3)"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><div class="empty-title">${msg}</div></div>`;
    return;
  }

  const sevOrder = { critical: 0, warning: 1, info: 2 };
  alarms.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  el.innerHTML = alarms.map((a, i) => {
    const icon = a.icon || '';
    const col  = sevColor[a.severity] || 'var(--text2)';
    const uid  = 'sev_' + i;
    const detail = a.plainText || a.text.replace(/<[^>]+>/g, '');
    return '<div class="alarm-item" style="cursor:pointer;border-left:3px solid ' + col + ';padding-left:10px;" onclick="toggleSysEventItem(\'' + uid + '\',this)">'
      + '<span class="alarm-icon">' + icon + '</span>'
      + '<span class="alarm-text">' + a.text + (a.batchName ? ' <span style="color:var(--text3);font-size:11px;">— ' + a.batchName + '</span>' : '') + '</span>'
      + '<span id="' + uid + '_arrow" style="margin-left:auto;font-size:11px;color:var(--text3);">▾</span>'
      + '</div>'
      + '<div id="' + uid + '_detail" style="display:none;padding:8px 12px 10px 36px;font-size:12px;color:var(--text2);border-left:3px solid ' + col + ';margin-bottom:4px;">'
      + '<div>' + detail + '</div>'
      + (a.batchId ? '<div style="margin-top:4px;color:var(--text3);">Партия: <strong>' + a.batchId + '</strong>' + (a.batchName ? ' — ' + a.batchName : '') + '</div>' : '')
      + '</div>';
  }).join('');
}

function renderJournalActions() {
  const el = document.getElementById('journal-actions-list');
  if (!el) return;
  const entries = (state.journalEntries || []).slice(0, 100);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div><div class="empty-title">Пока нет записей</div><div>Действия главного оператора и операторов участков появятся здесь</div></div>`;
    return;
  }
  el.innerHTML = entries.map((e, i) => {
    const time = new Date(e.timestamp).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    const uid = `act_${i}`;
    return `<div class="alarm-item" style="cursor:pointer;" onclick="toggleSysEventItem('${uid}',this)">
      <span class="alarm-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
      <span class="alarm-text">${e.text} <span style="color:var(--text3); font-size:11px;">— ${e.roleName} · ${e.source} · ${time}</span></span>
      <span id="${uid}_arrow" style="margin-left:auto;font-size:11px;color:var(--text3);">▾</span>
    </div>
    <div id="${uid}_detail" style="display:none; padding:8px 12px 10px 36px; font-size:12px; color:var(--text2); border-left:3px solid var(--border); margin-bottom:4px;">
      <div>${e.text}</div>
      ${e.batchId ? `<div style="margin-top:4px;color:var(--text3);">Партия: <strong>${e.batchId}</strong>${e.batchName ? ' — ' + e.batchName : ''}</div>` : ''}
      <div style="margin-top:2px;color:var(--text3);">Оператор: ${e.roleName} · ${e.source} · ${time}</div>
    </div>`;
  }).join('');
}

function goToJournalEntry(pageId, pmStage) {
  if (!pageId) return;
  goToAlarmPage(pageId, pmStage);
}

function switchJournalTab(tab, btn) {
  ['events','actions','batches'].forEach(t => {
    const el = document.getElementById('journal-tab-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('#journal-tabs .rtab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  state.journalActiveTab = tab;
  state.journalSeverityFilter = null;
}

function openJournalTab(tab) {
  goToPage('journal');
  requestAnimationFrame(() => {
    const btn = document.querySelector(`#journal-tabs .rtab[onclick*="'${tab}'"]`);
    switchJournalTab(tab, btn);
  });
}

function switchJournalTabFiltered(tab, severity) {
  const btn = document.querySelector(`#journal-tabs .rtab[onclick*="'${tab}'"]`);
  switchJournalTab(tab, btn);
  state.journalSeverityFilter = severity;
  renderSystemEvents();
}

function toggleSysEventItem(uid, row) {
  const detail = document.getElementById(uid + '_detail');
  const arrow  = document.getElementById(uid + '_arrow');
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? '' : 'none';
  if (arrow) arrow.textContent = open ? '▴' : '▾';
  row.style.background = open ? 'var(--surface2)' : '';
}

function toggleAlarmJournalItem(uid, row) {
  const detail = document.getElementById(uid + '_detail');
  const arrow  = document.getElementById(uid + '_arrow');
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? '' : 'none';
  if (arrow) arrow.textContent = open ? '▴' : '▾';
  if (open) row.style.background = 'var(--surface2)';
  else row.style.background = '';
}

function alarmJournalClick(pageId, pmStage) {
  const btn = document.querySelector(`#journal-tabs .rtab[onclick*="'events'"]`);
  switchJournalTab('events', btn);
  // scroll to top of system events
  const el = document.getElementById('journal-system-list');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderJournal() {
  const el = document.getElementById('journal-list');
  if (!el) return;
  renderSystemEvents();
  renderJournalActions();

  // восстанавливаем активный таб
  const activeTab = state.journalActiveTab || 'events';
  const activeBtn = document.querySelector(`#journal-tabs .rtab[onclick*="'${activeTab}'"]`);
  switchJournalTab(activeTab, activeBtn);

  const picker = document.getElementById('journal-date-picker');
  if (picker) picker.value = state.journalDate;
  updateDateNavUI('journal-date-human', 'journal-today-btn', state.journalDate);
  const dateLabel = document.getElementById('journal-date-label');
  if (dateLabel) dateLabel.textContent = state.journalShowAll ? 'Показаны все дни' : fmtDateHuman(state.journalDate);

  const statusFilter = state.journalStatusFilter || 'all';
  document.querySelectorAll('#journal-status-filters .filter-btn').forEach((btn, i) => {
    const order = ['all','planned','active','pouring','done','deviation','cancelled','deleted'];
    btn.classList.toggle('active', order[i] === statusFilter);
  });

  // фильтр по дате и фильтр по статусу работают одновременно, независимо друг от друга
  let batches = [...state.batches];
  if (!state.journalShowAll) batches = batches.filter(b => b.brewDate === state.journalDate);

  if (statusFilter === 'pouring') {
    // «Разливается» — не реальный b.status, а особое состояние: розлив начат, но не завершён
    batches = batches.filter(b => b.pouringStartedAt && !b.pouringEndedAt);
  } else if (statusFilter === 'deviation') {
    // партии с заметным расхождением план/факт (используем тот же порог, что и в алармах)
    batches = batches.filter(b => b.factQty !== null && b.factQty !== undefined && b.planQty &&
      Math.abs((b.factQty - b.planQty) / b.planQty * 100) >= ALARM_DEVIATION_THRESHOLD_PCT);
  } else if (statusFilter !== 'all') {
    batches = batches.filter(b => b.status === statusFilter);
  }

  batches.sort((a,b) => b.id.localeCompare(a.id));

  if (!batches.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><div class="empty-title">Нет записей по этому фильтру</div></div>'; return; }

  const role = getRoleById(currentUser.roleId);
  const canDelete = role && role.tabs.includes('admin');

  el.innerHTML = batches.map(b => {
    const dev = b.factQty && b.planQty ? ((b.factQty - b.planQty) / b.planQty * 100).toFixed(1) : null;
    const devColor = dev === null ? '' : Math.abs(dev) <= 3 ? 'var(--accent2)' : 'var(--warn)';
    const isDeleted = b.status === 'deleted';
    const isPouring = b.pouringStartedAt && !b.pouringEndedAt;
    return `<div class="card" style="${isDeleted ? 'border-color:var(--danger); opacity:0.85;' : ''}">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div class="reactor-badge rc-${reactorColor(b.reactor)}">${b.reactor.replace('Р-','')}</div>
        <div style="flex:1;">
          <div style="font-size:14px; font-weight:700;">${b.name}</div>
          <div style="font-size:12px; color:var(--text2); margin-top:2px;">${b.id} · ${fmtDateHuman(b.brewDate)} · ${b.volume} кг ${b.requestId ? `· ${b.requestId}` : ''}</div>
          ${b.brewStartedAt ? `<div style="font-size:12px; color:var(--text2); margin-top:2px;">Варка — начало: <strong>${new Date(b.brewStartedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</strong>${b.brewEndedAt ? ` · конец: <strong>${new Date(b.brewEndedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</strong> · заняло: <strong>${formatDuration(new Date(b.brewEndedAt) - new Date(b.brewStartedAt))}</strong>` : ' · <span style="color:var(--accent);">в процессе</span>'}</div>` : ''}
          ${b.pouringStartedAt ? `<div style="font-size:12px; color:var(--text2); margin-top:2px;">Розлив — начало: <strong>${new Date(b.pouringStartedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</strong>${b.pouringEndedAt ? ` · конец: <strong>${new Date(b.pouringEndedAt).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</strong> · заняло: <strong>${formatDuration(new Date(b.pouringEndedAt) - new Date(b.pouringStartedAt))}</strong>` : ' · <span style="color:var(--accent);">в процессе</span>'}</div>` : ''}
          ${!isDeleted ? `<div style="display:flex; gap:16px; margin-top:8px; flex-wrap:wrap;">
            <div><div style="font-size:11px;color:var(--text2);">ПЛАН</div><div style="font-size:18px; font-weight:800;">${b.planQty} шт</div></div>
            <div><div style="font-size:11px;color:var(--text2);">ФАКТ</div><div style="font-size:18px; font-weight:800; color:${b.factQty ? 'var(--accent2)' : 'var(--text3)'};">${b.factQty || '—'}</div></div>
            ${dev !== null ? `<div><div style="font-size:11px;color:var(--text2);">ОТКЛ.</div><div style="font-size:18px; font-weight:800; color:${devColor};">${dev > 0 ? '+' : ''}${dev}%</div></div>` : ''}
          </div>` : `<div class="note note-danger" style="margin-top:8px;">
            <strong>Удалено</strong> (был статус: ${statusLabel(b.deletedStatusBefore || '—')}) · ${b.deletedByRole || ''} · ${b.deletedAt ? new Date(b.deletedAt).toLocaleString('ru-RU') : ''}<br>
            Причина: ${b.deleteReason || '—'}
          </div>`}
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0;">
          <div class="${isPouring ? '' : `s-${b.status}`}" style="font-size:12px; font-weight:700; color:${isPouring ? 'var(--accent)' : ''};">${isPouring ? 'Разливается' : statusLabel(b.status)}</div>
          ${canDelete && !isDeleted ? `<button class="btn btn-danger btn-sm" onclick="openDeleteBatchModal('${b.id}')">Удалить</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// RECIPES
// ════════════════════════════════════════════════════════════════════════════
function recipesShowCategories() {
  state.recipesSelectedCategory = null;
  saveState();
  renderRecipes();
}

function recipesShowCategory(category) {
  state.recipesSelectedCategory = category;
  saveState();
  renderRecipes();
}

function renderRecipes() {
  const el = document.getElementById('recipes-list');
  if (!el) return;
  const role = getRoleById(currentUser.roleId);
  const isAdmin = role && role.tabs.includes('admin');

  const titleEl = document.getElementById('recipes-section-title');
  const subEl = document.getElementById('recipes-section-sub');
  const backBtn = document.getElementById('recipes-category-back');

  if (!state.recipesSelectedCategory) {
    // ── УРОВЕНЬ 1: список категорий, в алфавитном порядке ──
    if (titleEl) titleEl.textContent = 'Рецептуры — категории';
    if (subEl) subEl.textContent = 'Выберите категорию, чтобы увидеть продукты.';
    if (backBtn) backBtn.style.display = 'none';

    const categories = {};
    state.recipes.forEach(r => {
      const cat = r.category || 'Без категории';
      categories[cat] = (categories[cat] || 0) + 1;
    });
    const sortedCats = Object.keys(categories).sort((a,b) => a.localeCompare(b, 'ru'));

    if (!sortedCats.length) {
      el.innerHTML = `<div class="empty-state" style="padding:20px;"><div style="font-size:13px;">Нет рецептур — нажмите «+ Добавить»</div></div>`;
      return;
    }

    el.innerHTML = sortedCats.map(cat => `
      <div class="admin-menu-row" onclick="recipesShowCategory('${cat.replace(/'/g,"\\'")}')">
        <span class="admin-menu-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>
        <div class="admin-menu-text"><div class="admin-menu-title">${cat}</div><div class="admin-menu-sub">${categories[cat]} продукт${categories[cat]===1?'':categories[cat]<5?'а':'ов'}</div></div>
        <span class="admin-menu-arrow">›</span>
      </div>
    `).join('');
    return;
  }

  // ── УРОВЕНЬ 2: продукты внутри выбранной категории ──
  const cat = state.recipesSelectedCategory;
  if (titleEl) titleEl.textContent = cat;
  if (subEl) subEl.textContent = 'Состав сырья, нормы и время варки по каждому продукту.';
  if (backBtn) backBtn.style.display = 'inline-flex';

  const recipesInCat = state.recipes.filter(r => (r.category || 'Без категории') === cat);
  if (!recipesInCat.length) {
    el.innerHTML = `<div class="empty-state" style="padding:20px;"><div style="font-size:13px;">В этой категории пока нет продуктов</div></div>`;
    return;
  }

  el.innerHTML = recipesInCat.map(r => {
    const groupId = 'rcp-' + r.sku.replace(/[^a-zA-Z0-9]/g, '_');
    return `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; cursor:pointer;" onclick="toggleReportGroup('${groupId}', this)">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="report-group-chevron" style="display:inline-block; transition:transform .15s;">▾</span>
          <div>
            <div style="font-size:15px; font-weight:700;">${r.name}</div>
            <div style="font-size:12px; color:var(--text2); margin-top:2px;">${r.sku} · Базовая партия: ${r.baseBatch} кг · Тара: ${r.tara} л</div>
          </div>
        </div>
        <div style="text-align:right; display:flex; align-items:center; gap:14px;">
          <div>
            <div style="font-size:12px; font-weight:600; color:var(--text2);">Итого используется ${r.ingredients.length} компонентов</div>
            <div style="display:flex; align-items:center; gap:4px; margin-top:4px; justify-content:flex-end;" onclick="event.stopPropagation()">
              <span style="font-size:11px; color:var(--text2);">Время варки:</span>
              ${isAdmin
                ? `<input type="number" value="${r.brewHours||2}" min="0.5" step="0.5" style="width:54px; padding:2px 6px; font-size:12px; text-align:center;" onchange="setRecipeBrewHours('${r.sku}', parseFloat(this.value)||2)" />ч`
                : `<span style="font-size:12px; font-weight:700; color:var(--accent);">${r.brewHours||2}ч</span>`}
            </div>
          </div>
          ${isAdmin ? `
            <div style="width:1px; align-self:stretch; background:var(--border);"></div>
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); openIngredientsModal('${r.sku}')">Ввод сырья</button>
            <button class="btn btn-danger btn-sm" style="margin-left:8px;" onclick="event.stopPropagation(); openDeleteRecipeModal('${r.sku}')">Удалить</button>
          ` : ''}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px;">
        ${r.ingredients.sort((a,b)=>a.order-b.order).map(ing => `
          <div class="report-group-row" data-group="${groupId}" style="display:flex; align-items:center; gap:8px; font-size:13px; padding:4px 0; border-bottom:1px solid var(--border);">
            <span style="font-size:11px; color:var(--text3); width:16px; text-align:center;">${ing.order}</span>
            <span style="flex:1; color:var(--text);">${ing.name}</span>
            <span style="font-weight:700; color:var(--accent);">${ing.norm} ${ing.unit}</span>
          </div>
        `).join('')}
        ${!r.ingredients.length ? `<div class="report-group-row" data-group="${groupId}" style="font-size:12px; color:var(--text3); padding:6px 0;">Компоненты сырья пока не заданы${isAdmin ? ' — нажмите «Сырьё»' : ''}.</div>` : ''}
      </div>
    </div>
  `;
  }).join('');
}


// ════════════════════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════════════════════
function renderAdmin() {
  const role = getRoleById(currentUser.roleId);
  if (!role || !role.tabs.includes('admin')) return;
  renderNavMenuAdminList();
  const clEl = document.getElementById('clients-list');
  if (clEl) {
    clEl.innerHTML = state.clients.map((c,i) => `
      <div style="display:flex; align-items:center; gap:8px; background:var(--surface3); border-radius:8px; padding:6px 10px;">
        <span style="font-size:14px; font-weight:600; flex:1;">${c}</span>
        <button onclick="removeClient(${i})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">×</button>
      </div>`).join('');
  }

  const rEl = document.getElementById('reactors-list');
  if (rEl) {
    rEl.innerHTML = state.reactors.map((r,i) => `
      <div style="display:flex; align-items:center; gap:8px; background:var(--surface3); border-radius:8px; padding:6px 10px;">
        <div class="reactor-badge rc-${i+1}" style="width:26px;height:26px;font-size:11px;">${i+1}</div>
        <span style="font-size:14px; font-weight:600; flex:1;">${r}</span>
        <button onclick="removeReactor(${i})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">×</button>
      </div>`).join('');
  }

  const plEl = document.getElementById('pouring-lines-list');
  if (plEl) {
    plEl.innerHTML = state.pouringLines.map((l,i) => `
      <div style="display:flex; align-items:center; gap:8px; background:var(--surface3); border-radius:8px; padding:6px 10px;">
        <span style="font-size:14px; font-weight:600; flex:1;">${l}</span>
        <button onclick="removePouringLine(${i})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:16px;">×</button>
      </div>`).join('');
  }

  renderRolesList();
  renderRecipes();

  const wd = document.getElementById('settings-workday'); if (wd) wd.value = state.workdayHours;
  ['googleSheets','telegram','email'].forEach(key => {
    const inp = document.getElementById(`int-${key}`);
    if (inp && !inp.value) inp.value = state.integrations[key] || '';
  });
}

// ════════════════════════════════════════════════════════════════════════════
// АДМИН-ПАНЕЛЬ: навигация список → раздел
// ════════════════════════════════════════════════════════════════════════════
function openAdminSection(name) {
  document.getElementById('admin-menu').style.display = 'none';
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  const section = document.getElementById(`admin-section-${name}`);
  if (section) section.style.display = 'block';
  if (name === 'recipes') state.recipesSelectedCategory = null;
  if (name === 'branding') initBrandingSection();
  if (name === 'activitylog') renderActivityLog();
  if (name === 'access') renderSsoUsersList();
  renderAdmin();
}

// ── Доступы: сотрудники портала → роль-должность (2026-07-25, «галочная» модель) ──
// Список — ВСЕ, у кого есть доступ к Производству на портале (varka.kz/api/permissions
// под токеном портала, тот же домен), не дожидаясь их первого входа; слитый с локально
// назначенными ролями (/sso-users). Если портал недоступен (или админ не портальный) —
// фолбэк на тех, кто уже заходил. Роли — из state.roles («Просмотр» — дефолт, прячем).
async function renderSsoUsersList() {
  const box = document.getElementById('sso-users-list');
  if (!box) return;
  box.innerHTML = '<div style="padding:12px;color:var(--text2);">Загрузка…</div>';

  // Локально назначенные роли (по кому уже есть строка в sso_role_map).
  const assigned = {};
  try {
    const res = await apiFetch('/sso-users');
    const data = await res.json();
    (data.users || []).forEach(u => { assigned[u.portal_user_id] = u; });
  } catch (e) { /* эндпоинт недоступен — покажем что сможем */ }

  // Ростер: все с доступом к Производству на портале (не дожидаясь входа).
  let roster = null;
  try {
    const pt = localStorage.getItem('portal_token');
    if (pt) {
      const pr = await fetch('https://varka.kz/api/permissions', { headers: { 'Authorization': 'Bearer ' + pt } });
      if (pr.ok) {
        const pd = await pr.json();
        roster = (pd.permissions || [])
          .filter(p => p.project_code === 'manufacture' && p.level !== 'none')
          .map(p => ({ portal_user_id: p.user_id, name: p.full_name, email: p.email }));
      }
    }
  } catch (e) { /* портал недоступен — фолбэк на локальный список ниже */ }

  const list = roster
    ? roster.map(r => ({ portal_user_id: r.portal_user_id, name: r.name, email: r.email,
        role_id: assigned[r.portal_user_id] ? assigned[r.portal_user_id].role_id : null }))
    : Object.values(assigned);

  if (!list.length) {
    box.innerHTML = '<div style="padding:12px;color:var(--text2);">Пока никому не выдан доступ к Производству. Выдайте на портале: varka.kz → «Пользователи и права».</div>';
    return;
  }
  // ДВЕ независимые вещи: ДОЛЖНОСТЬ (что видит) и УРОВЕНЬ (что может делать).
  // Из списка должностей убраны «Админ» и «Просмотр» — теперь это уровни, а не
  // должности (иначе в одном списке смешивались бы разные сущности).
  const roles = (state.roles || []).filter(r => r.id !== 'viewer' && !r.fullAccess);
  const LEVELS = [['viewer','Просмотр'],['manager','Редактирование'],['admin','Админ']];
  box.innerHTML = list.map(u => {
    const roleOpts = ['<option value="">— не назначена —</option>']
      .concat(roles.map(r => `<option value="${escapeHtml(r.id)}" ${u.role_id === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`))
      .join('');
    const lvl = u.level || 'viewer';
    const lvlOpts = LEVELS.map(([v,label]) => `<option value="${v}" ${lvl === v ? 'selected' : ''}>${label}</option>`).join('');
    const who = escapeHtml(u.name || u.email || ('ID ' + u.portal_user_id));
    const sub = (u.email && u.name) ? escapeHtml(u.email) : '';
    const sel = 'padding:6px 8px; border:1px solid var(--border); border-radius:8px; background:var(--surface2); color:var(--text);';
    return `
      <div data-uid="${u.portal_user_id}" data-name="${escapeHtml(u.name || '')}" data-email="${escapeHtml(u.email || '')}"
           style="display:flex; align-items:center; gap:10px; background:var(--surface3); border-radius:8px; padding:8px 12px; flex-wrap:wrap;">
        <div style="flex:1; min-width:140px;">
          <div style="font-size:14px; font-weight:600;">${who}</div>
          ${sub ? `<div style="font-size:12px; color:var(--text2);">${sub}</div>` : ''}
        </div>
        <label style="font-size:12px; color:var(--text2);">Должность
          <select class="ssu-role" onchange="saveSsoUserRole(this)" style="${sel} min-width:180px; display:block; margin-top:2px;">${roleOpts}</select>
        </label>
        <label style="font-size:12px; color:var(--text2);">Уровень
          <select class="ssu-level" onchange="saveSsoUserRole(this)" style="${sel} min-width:150px; display:block; margin-top:2px;">${lvlOpts}</select>
        </label>
      </div>`;
  }).join('');
}

// Сохраняем обе настройки строки сразу — должность и уровень независимы, но
// хранятся одной записью (any select в строке шлёт актуальное состояние обоих).
async function saveSsoUserRole(sel) {
  const row = sel.closest('[data-uid]');
  if (!row) return;
  const uid = parseInt(row.dataset.uid, 10);
  const roleId = row.querySelector('.ssu-role')?.value || null;
  const level  = row.querySelector('.ssu-level')?.value || 'viewer';
  try {
    const res = await apiFetch('/sso-users', {
      method: 'POST',
      body: JSON.stringify({ portal_user_id: uid, name: row.dataset.name || null, email: row.dataset.email || null, role_id: roleId, level }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'Ошибка сохранения'); return; }
    showToast('Доступ сохранён');
  } catch (e) {
    showToast('Ошибка сети');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// БРЕНДИНГ
// ════════════════════════════════════════════════════════════════════════════
function initBrandingSection() {
  const nameEl = document.getElementById('branding-name');
  if (nameEl) nameEl.value = state.companyName || '';
  updateBrandingLogoPreview();
}

function updateBrandingLogoPreview() {
  const preview = document.getElementById('branding-logo-preview');
  if (!preview) return;
  // companyLogo (legacy base64) — фолбэк на время до срабатывания migrateLegacyLogo().
  const logoSrc = state.companyLogoUrl || state.companyLogo;
  if (logoSrc) {
    preview.innerHTML = `<img src="${logoSrc}" style="max-height:40px; max-width:116px; object-fit:contain;" />`;
  } else {
    preview.textContent = 'Нет логотипа';
  }
}

function previewBranding() {}

function uploadBrandingLogo(input) {
  const file = input.files[0];
  if (!file) return;
  // Аудит безопасности §3: без лимита файл в base64 (+~33% размера) уходит в
  // state.companyLogo и в единый документ Firestore (лимит 1 МиБ на весь документ) —
  // раздутие ломает saveState() для всех пользователей разом, не только для того, кто грузил.
  const MAX_LOGO_BYTES = 250 * 1024;
  if (file.size > MAX_LOGO_BYTES) {
    showToast(`Файл слишком большой (${Math.round(file.size/1024)} КБ) — максимум 250 КБ`);
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      // Определяем цвет фона по углам
      const bgR = px[0], bgG = px[1], bgB = px[2];
      const thresh = 30;
      for (let i = 0; i < px.length; i += 4) {
        const dr = Math.abs(px[i]   - bgR);
        const dg = Math.abs(px[i+1] - bgG);
        const db = Math.abs(px[i+2] - bgB);
        if (dr < thresh && dg < thresh && db < thresh) px[i+3] = 0;
      }
      ctx.putImageData(data, 0, 0);
      // Логотипы почти всегда экспортируют с запасом по краям. Прозрачным этот
      // запас стал строкой выше, но размер холста прежний — и в шапке он читается
      // как «логотип съехал от левого края». Обрезаем по реальному контуру.
      uploadBrandingLogoDataUrl(cropTransparentEdges(canvas).toDataURL('image/png'));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Обрезает холст по bounding box непрозрачных пикселей. Если непрозрачных нет
// (например, фон «съел» всю картинку) — возвращает исходный холст, чтобы не
// отдать наверх пустое изображение.
function cropTransparentEdges(canvas) {
  const w = canvas.width, h = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return canvas;
  const out = document.createElement('canvas');
  out.width  = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// Заливает готовый dataURL на сервер как обычный статический файл (api/branding.php)
// и оставляет в state только короткую ссылку — вместо ~350КБ base64 внутри самого
// state, которые раньше качались целиком при КАЖДОЙ загрузке страницы (см. комментарий
// у _getCachedRev в apiFetch-блоке).
async function uploadBrandingLogoDataUrl(dataUrl) {
  try {
    const res = await fetchWithTimeout(API_BASE + '/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    state.companyLogoUrl = j.url;
    delete state.companyLogo; // на случай если ещё оставался старый base64-формат
    updateBrandingLogoPreview();
    applyBranding();
  } catch (e) {
    console.error('[Branding] загрузка логотипа не удалась:', e);
    if (typeof showToast === 'function') showToast('Не удалось загрузить логотип — сервер недоступен');
  }
}

async function removeBrandingLogo() {
  try {
    await fetchWithTimeout(API_BASE + '/branding', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + authToken },
    });
  } catch (e) {}
  state.companyLogoUrl = null;
  delete state.companyLogo;
  const input = document.getElementById('branding-logo-input');
  if (input) input.value = '';
  updateBrandingLogoPreview();
  applyBranding();
}

function saveBranding() {
  const nameEl = document.getElementById('branding-name');
  state.companyName = nameEl ? nameEl.value.trim() : '';
  saveState();
  applyBranding();
  closeAdminSection();
}

function applyBranding() {
  const el = document.getElementById('nav-logo-area');
  if (!el) return;
  const logoSrc = state.companyLogoUrl || state.companyLogo; // companyLogo — фолбэк до миграции
  if (logoSrc) {
    // Размеры — в CSS (.nav-logo img), чтобы работали media-запросы: на мобильных
    // шапка ниже 64px, а inline-стиль оттуда не перебить.
    el.innerHTML = `<img src="${logoSrc}" alt="" />`;
    showTrimmedLogo(el.querySelector('img'), logoSrc);
  } else if (state.companyName) {
    el.textContent = state.companyName;
    el.style.color = '';
  } else {
    el.innerHTML = 'Вар<span style="color:var(--text2); font-weight:400;">Ка</span>';
  }
}

// Логотип на сервере мог быть залит ДО появления обрезки при загрузке. Так и вышло
// с текущим: файл 1536x1024, а сам знак — 1181x421 в середине, вокруг прозрачные
// поля (274px сверху, 329px снизу). object-fit:contain вписывает в бокс весь кадр
// вместе с полями, поэтому в шапке высотой 56px знак занимал только 23px.
// Обрезаем при отрисовке, а не только при заливке — тогда уже загруженные логотипы
// чинятся сами, без перезаливки через админку.
// Строго визуально: ни state, ни файл на сервере не трогаем — записи в БД тут нет.
let _trimmedLogo = { src: null, url: null };

function showTrimmedLogo(img, src) {
  if (!img) return;
  if (_trimmedLogo.src === src) {           // уже считали для этого файла
    if (_trimmedLogo.url) img.src = _trimmedLogo.url;
    return;
  }
  const probe = new Image();
  probe.onload = () => {
    let url = null;
    try {
      const c = document.createElement('canvas');
      c.width = probe.naturalWidth;
      c.height = probe.naturalHeight;
      c.getContext('2d').drawImage(probe, 0, 0);
      const cropped = cropTransparentEdges(c);
      // Если полей не было — не гоняем картинку через dataURL впустую.
      if (cropped.width !== c.width || cropped.height !== c.height) {
        url = cropped.toDataURL('image/png');
      }
    } catch (e) {
      // Канвас может оказаться «испорчен» (логотип с чужого origin) — читать пиксели
      // тогда нельзя. Не беда: остаётся исходная картинка, просто без обрезки.
    }
    _trimmedLogo = { src, url };
    if (url) img.src = url;
  };
  probe.src = src;
}

function closeAdminSection() {
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
  document.getElementById('admin-menu').style.display = 'block';
}

// ════════════════════════════════════════════════════════════════════════════
// КОНСТРУКТОР РОЛЕЙ
// ════════════════════════════════════════════════════════════════════════════
function renderRolesList() {
  const el = document.getElementById('roles-list');
  if (!el) return;
  el.innerHTML = state.roles.map(r => `
    <div style="display:flex; align-items:center; gap:10px; background:var(--surface3); border-radius:10px; padding:10px 14px;">
      <div style="width:36px; height:36px; border-radius:50%; background:var(--accent); display:flex; align-items:center; justify-content:center; font-weight:800; color:#fff; flex-shrink:0;">${r.name.charAt(0).toUpperCase()}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:14px; font-weight:700;">${r.name}</div>
        <div style="font-size:12px; color:var(--text2);">Логин: ${r.login} · ${r.tabs.length} вкладок доступно</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openEditRoleModal('${r.id}')">Редактировать</button>
    </div>
  `).join('');
}

function openCreateRoleModal() {
  document.getElementById('role-modal-title').textContent = 'Новая роль';
  document.getElementById('role-edit-id').value = '';
  document.getElementById('role-name').value = '';
  document.getElementById('role-login').value = '';
  document.getElementById('role-password').value = '';
  document.getElementById('role-delete-btn').style.display = 'none';
  document.getElementById('role-full-access-toggle').classList.remove('on');
  renderRoleTabsCheckboxes([]);
  renderRoleFieldsCheckboxes({}, []);
  document.getElementById('modal-role').classList.add('open');
}

function openEditRoleModal(roleId) {
  const r = getRoleById(roleId);
  if (!r) return;
  document.getElementById('role-modal-title').textContent = `Роль: ${r.name}`;
  document.getElementById('role-edit-id').value = r.id;
  document.getElementById('role-name').value = r.name;
  document.getElementById('role-login').value = r.login;
  // Пароль хранится на сервере (bcrypt) и в state его больше нет — поле пустое.
  // Пусто при сохранении = «не менять пароль» (см. saveRoleFromModal).
  const pwdField = document.getElementById('role-password');
  pwdField.value = '';
  pwdField.placeholder = 'оставьте пустым — пароль не изменится';
  document.getElementById('role-delete-btn').style.display = state.roles.length > 1 ? 'inline-flex' : 'none';
  const tog = document.getElementById('role-full-access-toggle');
  tog.classList.toggle('on', !!r.fullAccess);
  renderRoleTabsCheckboxes(r.tabs);
  renderRoleFieldsCheckboxes(r.fields || {}, r.tabs);
  document.getElementById('modal-role').classList.add('open');
}

function renderRoleTabsCheckboxes(selectedTabs) {
  const el = document.getElementById('role-tabs-list');
  el.innerHTML = getEffectiveTabs().map(([id, label]) => `
    <div class="role-field-row">
      <span>${label}</span>
      <div class="toggle ${selectedTabs.includes(id)?'on':''}" data-tab-id="${id}" onclick="this.classList.toggle('on'); refreshRoleFieldsFromCurrentTabs();"></div>
    </div>`).join('');
}

// При изменении выбранных вкладок сразу обновляем список полей — чтобы новая
// вкладка-зависимая настройка (например "Отображать дату") появилась без
// необходимости сохранять и заново открывать форму редактирования роли.
function refreshRoleFieldsFromCurrentTabs() {
  const currentTabs = Array.from(document.querySelectorAll('#role-tabs-list .toggle.on')).map(t => t.dataset.tabId);
  // сохраняем текущие значения полей, чтобы не сбросить уже выставленные тумблеры
  const currentFields = {};
  document.querySelectorAll('#role-fields-list .toggle').forEach(t => { currentFields[t.dataset.fieldKey] = t.classList.contains('on'); });
  renderRoleFieldsCheckboxes(currentFields, currentTabs);
}

// Некоторые поля относятся только к ролям с доступом к конкретной вкладке
// (например, выбор даты на странице варочного участка не имеет смысла показывать
// при редактировании роли без доступа к этой вкладке) — привязка идёт по самой
// вкладке (tab), а не по техническому id роли, чтобы не зависеть от того, как
// и когда роль была создана.
const FIELD_VISIBLE_FOR_TABS = {
  dateNavWarshchik: ['warshchik'],
  dateNavIntake: ['intake'],
};

function renderRoleFieldsCheckboxes(fieldsObj, selectedTabs) {
  const el = document.getElementById('role-fields-list');
  const tabs = selectedTabs || [];
  const visibleFields = CONFIGURABLE_FIELDS.filter(([key]) => {
    const restriction = FIELD_VISIBLE_FOR_TABS[key];
    if (!restriction) return true; // поле без ограничений — видно всем ролям
    return restriction.some(tab => tabs.includes(tab));
  });
  el.innerHTML = visibleFields.map(([key,label]) => `
    <div class="role-field-row">
      <span>${label}</span>
      <div class="toggle ${fieldsObj[key]?'on':''}" data-field-key="${key}" onclick="this.classList.toggle('on')"></div>
    </div>`).join('');
}

function saveRoleFromModal() {
  const editId = document.getElementById('role-edit-id').value;
  const name = document.getElementById('role-name').value.trim();
  const login = document.getElementById('role-login').value.trim();
  const password = document.getElementById('role-password').value.trim();
  // Пароль обязателен только для НОВОЙ роли. При редактировании пустое поле =
  // «не менять пароль» (он на сервере). Иначе любое сохранение роли перезаписало
  // бы пароль пустышкой и отрезало сотруднику вход.
  if (!name || !login) { showToast('Заполните название и логин'); return; }
  if (!editId && !password) { showToast('Задайте пароль для новой роли'); return; }

  // проверка уникальности логина (кроме самой себя при редактировании)
  const loginTaken = state.roles.some(r => r.login === login && r.id !== editId);
  if (loginTaken) { showToast('Этот логин уже используется другой ролью'); return; }

  const tabs = Array.from(document.querySelectorAll('#role-tabs-list .toggle.on')).map(t => t.dataset.tabId);
  const fields = {};
  document.querySelectorAll('#role-fields-list .toggle').forEach(t => { fields[t.dataset.fieldKey] = t.classList.contains('on'); });
  const fullAccess = document.getElementById('role-full-access-toggle').classList.contains('on');

  if (!tabs.length) { showToast('Выберите хотя бы одну вкладку'); return; }

  if (editId) {
    const r = getRoleById(editId);
    r.name = name; r.login = login; r.tabs = tabs; r.fields = fields; r.fullAccess = fullAccess;
    // пароль трогаем только если админ его ввёл; пусто = сервер оставит старый
    if (password) r.password = password; else delete r.password;
    showToast(`Роль «${name}» обновлена`);
  } else {
    const id = 'role_' + Date.now();
    state.roles.push({ id, name, login, password, tabs, fields, fullAccess });
    showToast(`Роль «${name}» создана`);
  }

  saveState();
  closeModal('modal-role');
  renderRolesList();
  renderWarshchikBatches();
}

function deleteRoleFromModal() {
  const editId = document.getElementById('role-edit-id').value;
  if (!editId) return;
  if (state.roles.length <= 1) { showToast('Должна остаться хотя бы одна роль'); return; }
  const r = getRoleById(editId);
  const ok = confirm(`Удалить роль «${r.name}»? Пользователи с этим логином больше не смогут войти.`);
  if (!ok) return;
  state.roles = state.roles.filter(x => x.id !== editId);
  saveState();
  closeModal('modal-role');
  renderRolesList();
  showToast('Роль удалена');
}

// ════════════════════════════════════════════════════════════════════════════
// УДАЛЕНИЕ ВАРОК (мягкое — статус 'deleted', видно только в Журнале)
// Кнопка удаления — прямо на карточке варки на странице "Варки"
// ════════════════════════════════════════════════════════════════════════════
function openDeleteBatchModal(batchId) {
  const b = getBatchById(batchId);
  if (!b) return;
  document.getElementById('delete-batch-info').innerHTML = `<strong>${b.name}</strong><br>${b.id} · ${b.reactor} · ${fmtDateHuman(b.brewDate)} · ${b.volume} кг`;
  document.getElementById('delete-batch-reason').value = '';
  document.getElementById('delete-batch-reason').dataset.batchId = batchId;
  document.getElementById('modal-delete-batch').classList.add('open');
}

function confirmDeleteBatch() {
  const reasonEl = document.getElementById('delete-batch-reason');
  const reason = reasonEl.value.trim();
  const batchId = reasonEl.dataset.batchId;
  if (!reason) { showToast('Укажите причину удаления'); return; }
  const b = getBatchById(batchId);
  if (!b) return;

  b.deletedStatusBefore = b.status; // сохраняем, в каком статусе была варка до удаления — для истории
  b.status = 'deleted';
  b.deleteReason = reason;
  b.deletedAt = new Date().toISOString();
  b.deletedByRole = (getRoleById(currentUser.roleId) || {}).name || currentUser.roleId;

  saveState();
  closeModal('modal-delete-batch');
  render();
  showToast(`Варка ${batchId} удалена`);
}

function addClient() {
  const name = document.getElementById('new-client-name').value.trim();
  if (!name) return;
  state.clients.push(name);
  state.wpClients.push(name);
  document.getElementById('new-client-name').value = '';
  saveState(); renderAdmin(); populateSelects(); renderWeekPlan();
  showToast(`Клиент «${name}» добавлен`);
}
function removeClient(i) {
  const name = state.clients[i];
  state.clients.splice(i,1);
  const wpIdx = state.wpClients.indexOf(name);
  if (wpIdx >= 0) state.wpClients.splice(wpIdx, 1);
  saveState(); renderAdmin(); populateSelects(); renderWeekPlan();
}

function addReactor() {
  const name = document.getElementById('new-reactor-name').value.trim();
  if (!name) return;
  state.reactors.push(name);
  document.getElementById('new-reactor-name').value = '';
  saveState(); render();
  showToast(`Реактор ${name} добавлен`);
}
function removeReactor(i) { state.reactors.splice(i,1); saveState(); render(); }

function addPouringLine() {
  const name = document.getElementById('new-pouring-line-name').value.trim();
  if (!name) return;
  state.pouringLines.push(name);
  document.getElementById('new-pouring-line-name').value = '';
  saveState(); render();
  showToast(`Линия «${name}» добавлена`);
}
function removePouringLine(i) { state.pouringLines.splice(i,1); saveState(); render(); }

// ════════════════════════════════════════════════════════════════════════════
// АДМИН-ПАНЕЛЬ: Боковое меню — порядок и названия пунктов навигации
// ════════════════════════════════════════════════════════════════════════════
function renderNavMenuAdminList() {
  const el = document.getElementById('navmenu-list');
  if (!el) return;
  const tabs = getEffectiveTabs();
  el.innerHTML = tabs.map((t, i) => `
    <div style="display:flex; align-items:center; gap:8px; background:var(--surface3); border-radius:8px; padding:6px 10px;">
      <span style="font-size:16px; width:22px; text-align:center; flex-shrink:0;">${t[2]||'•'}</span>
      <input type="text" value="${t[1]}" style="flex:1; font-size:13px; font-weight:600;" onchange="renameNavTab('${t[0]}', this.value)" />
      <button onclick="moveNavTab('${t[0]}', -1)" ${i===0?'disabled':''} style="background:none; border:none; color:var(--text2); cursor:pointer; font-size:15px; padding:2px 6px; opacity:${i===0?0.3:1};" title="Выше">▲</button>
      <button onclick="moveNavTab('${t[0]}', 1)" ${i===tabs.length-1?'disabled':''} style="background:none; border:none; color:var(--text2); cursor:pointer; font-size:15px; padding:2px 6px; opacity:${i===tabs.length-1?0.3:1};" title="Ниже">▼</button>
    </div>`).join('');
}

function moveNavTab(id, direction) {
  const ids = getEffectiveTabs().map(t => t[0]);
  const idx = ids.indexOf(id);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= ids.length) return;
  [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
  state.navTabsOrder = ids;
  saveState();
  renderNavMenuAdminList();
  refreshNavTabs();
}

function renameNavTab(id, value) {
  const name = value.trim();
  if (!state.navTabsLabels) state.navTabsLabels = {};
  if (!name) delete state.navTabsLabels[id];
  else state.navTabsLabels[id] = name;
  saveState();
  renderNavMenuAdminList();
  refreshNavTabs();
}

function resetNavMenuToDefault() {
  state.navTabsOrder = [];
  state.navTabsLabels = {};
  saveState();
  renderNavMenuAdminList();
  refreshNavTabs();
  showToast('Меню сброшено к стандартному порядку и названиям');
}

function saveWorkdayHours() {
  state.workdayHours = parseFloat(document.getElementById('settings-workday').value) || 8;
  saveState(); render();
}

const INTEGRATION_NAMES = { googleSheets: 'Google Sheets', telegram: 'Telegram', email: 'Email' };

function saveIntegration(key) {
  const value = document.getElementById(`int-${key}`).value.trim();
  state.integrations[key] = value;
  if (key === 'googleSheets') state.sheetsUrl = value; // держим legacy-поле синхронным
  saveState();
  showToast(value ? `${INTEGRATION_NAMES[key]} подключён` : `${INTEGRATION_NAMES[key]} отключён`);
}

function setRecipeBrewHours(sku, hours) {
  const r = state.recipes.find(x => x.sku === sku);
  if (r) { r.brewHours = hours; saveState(); renderWeekPlan(); }
}

function openAddRecipeModal() {
  document.getElementById('r-name').value = '';
  document.getElementById('r-category').value = state.recipesSelectedCategory || '';
  document.getElementById('r-base').value = '';
  document.getElementById('r-tara').value = '';
  document.getElementById('r-brewhours').value = '';

  // подсказки категорий — все уже существующие, в алфавитном порядке
  const cats = [...new Set(state.recipes.map(r => r.category || 'Без категории'))].sort((a,b) => a.localeCompare(b, 'ru'));
  document.getElementById('r-category-options').innerHTML = cats.map(c => `<option value="${c}"></option>`).join('');

  document.getElementById('modal-recipe').classList.add('open');
}

function addRecipe() {
  const name = document.getElementById('r-name').value.trim();
  const category = document.getElementById('r-category').value.trim() || 'Без категории';
  const base = parseFloat(document.getElementById('r-base').value);
  const tara = parseFloat(document.getElementById('r-tara').value);
  const brewHours = parseFloat(document.getElementById('r-brewhours').value) || 2;
  if (!name || !base || !tara) { showToast('Заполните название, базовую партию и тару'); return; }

  const sku = generateSku(name);
  state.recipes.push({ sku, name, category, baseBatch: base, tara, brewHours, ingredients: [] });
  saveState();
  closeModal('modal-recipe');
  state.recipesSelectedCategory = category; // сразу открываем категорию, куда попал новый продукт
  saveState();
  renderRecipes();
  populateSelects();
  renderWeekPlan();
  showToast(`Рецептура «${name}» добавлена (${sku})`);
}

// ════════════════════════════════════════════════════════════════════════════
// КОМПОНЕНТЫ СЫРЬЯ — полноценный редактор (добавление/удаление/правка)
// ════════════════════════════════════════════════════════════════════════════
let ingredientRowCounter = 0;

function openIngredientsModal(sku) {
  const r = state.recipes.find(x => x.sku === sku);
  if (!r) return;
  document.getElementById('ingredients-modal-title').textContent = `Компоненты — ${r.name}`;
  document.getElementById('ingredients-recipe-sku').value = sku;
  const listEl = document.getElementById('ingredients-edit-list');
  listEl.innerHTML = '';
  ingredientRowCounter = 0;
  const sorted = [...r.ingredients].sort((a,b) => a.order - b.order);
  if (sorted.length) {
    sorted.forEach(ing => addIngredientRow(ing));
  } else {
    addIngredientRow(); // хотя бы одна пустая строка для старта
  }
  document.getElementById('modal-ingredients').classList.add('open');
}

function addIngredientRow(ing) {
  ingredientRowCounter++;
  const rowId = `ing-edit-row-${ingredientRowCounter}`;
  const listEl = document.getElementById('ingredients-edit-list');
  const wrap = document.createElement('div');
  wrap.id = rowId;
  wrap.style = 'display:flex; gap:6px; align-items:center;';
  wrap.innerHTML = `
    <input type="text" class="ing-edit-name" placeholder="Название компонента" value="${ing ? ing.name.replace(/"/g,'&quot;') : ''}" style="flex:2;"
      oninput="(function(el){const u=el.closest('div').querySelector('.ing-edit-unit');if(/краситель|краска|пигмент/i.test(el.value))u.value='г';else if(u.value==='г'&&!/краситель|краска|пигмент/i.test(el.value))u.value='кг';})(this)" />
    <input type="number" class="ing-edit-norm" placeholder="Норма" value="${ing ? ing.norm : ''}" step="0.01" style="width:90px;" />
    <select class="ing-edit-unit" style="width:70px;">
      <option value="кг" ${!ing || ing.unit==='кг' ? 'selected':''}>кг</option>
      <option value="г" ${ing && ing.unit==='г' ? 'selected':''}>г</option>
      <option value="л" ${ing && ing.unit==='л' ? 'selected':''}>л</option>
      <option value="мл" ${ing && ing.unit==='мл' ? 'selected':''}>мл</option>
      <option value="шт" ${ing && ing.unit==='шт' ? 'selected':''}>шт</option>
    </select>
    <input type="number" class="ing-edit-order" placeholder="№" value="${ing ? ing.order : ingredientRowCounter}" min="1" style="width:50px;" title="Порядок закладки" />
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('${rowId}').remove()" title="Удалить компонент">×</button>
  `;
  listEl.appendChild(wrap);
}

function saveIngredientsFromModal() {
  const sku = document.getElementById('ingredients-recipe-sku').value;
  const r = state.recipes.find(x => x.sku === sku);
  if (!r) return;

  const rows = document.querySelectorAll('#ingredients-edit-list > div');
  const ingredients = [];
  let hasError = false;
  rows.forEach(row => {
    const name = row.querySelector('.ing-edit-name').value.trim();
    const norm = parseFloat(row.querySelector('.ing-edit-norm').value);
    const unit = row.querySelector('.ing-edit-unit').value;
    const order = parseInt(row.querySelector('.ing-edit-order').value) || (ingredients.length + 1);
    if (!name && !norm) return; // пустую строку просто пропускаем, не считаем ошибкой
    if (!name || !norm) { hasError = true; return; }
    ingredients.push({ name, norm, unit, order });
  });

  if (hasError) { showToast('Заполните название и норму у каждого компонента (или удалите пустую строку)'); return; }
  if (!ingredients.length) { showToast('Добавьте хотя бы один компонент'); return; }

  r.ingredients = ingredients;
  saveState();
  closeModal('modal-ingredients');
  renderRecipes();
  showToast(`Сырьё для «${r.name}» обновлено (${ingredients.length} компонентов)`);
}

// ════════════════════════════════════════════════════════════════════════════
// УДАЛЕНИЕ РЕЦЕПТУРЫ
// ════════════════════════════════════════════════════════════════════════════
function openDeleteRecipeModal(sku) {
  const r = state.recipes.find(x => x.sku === sku);
  if (!r) return;
  document.getElementById('delete-recipe-info').innerHTML = `<strong>${r.name}</strong><br>${r.sku} · ${r.category} · ${r.ingredients.length} компонентов`;
  document.getElementById('delete-recipe-info').dataset.sku = sku;
  document.getElementById('modal-delete-recipe').classList.add('open');
}

function confirmDeleteRecipe() {
  const sku = document.getElementById('delete-recipe-info').dataset.sku;
  const idx = state.recipes.findIndex(r => r.sku === sku);
  if (idx === -1) return;
  const name = state.recipes[idx].name;
  state.recipes.splice(idx, 1);
  saveState();
  closeModal('modal-delete-recipe');
  renderRecipes();
  populateSelects();
  renderWeekPlan();
  showToast(`Рецептура «${name}» удалена`);
}

// ════════════════════════════════════════════════════════════════════════════
// TOAST / MODAL UTILS
// ════════════════════════════════════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

;

// ════════════════════════════════════════════════════════════════════════════
// MODAL: НОВАЯ ЗАЯВКА
// ════════════════════════════════════════════════════════════════════════════
let reqItemCounter = 0;

function openCreateRequestModal() {
  populateSelects();
  document.getElementById('req-date').value = fmtDateHuman(fmtDate(new Date()));
  document.getElementById('req-client').value = '';
  document.getElementById('req-ship-date').value = '';
  document.getElementById('req-brew-date').value = '';
  document.getElementById('req-brew-hours').value = '';
  document.getElementById('req-conflict-note').style.display = 'none';
  document.getElementById('req-buffer-preview').innerHTML = '';
  document.getElementById('req-items').innerHTML = '';
  reqItemCounter = 0;
  addRequestItemRow();
  document.getElementById('modal-request').classList.add('open');
}

function addRequestItemRow() {
  reqItemCounter++;
  const rowId = `req-item-${reqItemCounter}`;
  const wrap = document.createElement('div');
  wrap.id = rowId;
  wrap.style = 'display:flex; gap:8px; margin-bottom:8px; align-items:flex-end;';
  wrap.innerHTML = `
    <div style="flex:2;">
      <select class="req-item-sku" style="width:100%;">
        <option value="">— продукт —</option>
        ${state.recipes.map(r => `<option value="${r.sku}">${r.name}</option>`).join('')}
      </select>
    </div>
    <div style="flex:1;">
      <input class="req-item-qty" type="number" placeholder="Кол-во шт" min="1" />
    </div>
    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('${rowId}').remove()">×</button>
  `;
  document.getElementById('req-items').appendChild(wrap);
}

function recalcBrewDate() {
  const shipDate = document.getElementById('req-ship-date').value;
  const brewInput = document.getElementById('req-brew-date');
  if (shipDate && !brewInput.value) {
    // default: brew 1 day before shipping
    brewInput.value = fmtDate(addDays(new Date(shipDate), -1));
  }
  updateReqBufferPreview();
}

function updateReqBufferPreview() {
  const date = document.getElementById('req-brew-date').value;
  const reactor = document.getElementById('req-reactor').value;
  const hours = parseFloat(document.getElementById('req-brew-hours').value) || 0;
  const el = document.getElementById('req-buffer-preview');
  if (!date || !reactor) { el.innerHTML = ''; return; }

  const load = getReactorDayLoad(reactor, date, null);
  const free = Math.max(0, state.workdayHours - load);
  const afterTotal = load + hours;
  const overLimit = afterTotal > state.workdayHours;

  el.innerHTML = `<div class="note ${overLimit ? 'note-danger' : 'note-warn'}" style="margin-bottom:10px;">
    <strong>${reactor}</strong> на ${fmtDateHuman(date)}: занято <strong>${load}ч</strong> из ${state.workdayHours}ч ·
    свободно <strong>${free}ч</strong>
    ${hours ? (overLimit
        ? `<br>Превышение лимита дня на ${(afterTotal - state.workdayHours).toFixed(1)}ч`
        : `<br>После этой варки (${hours}ч) останется ${(free - hours).toFixed(1)}ч буфера`)
      : ''}
  </div>`;
}

function createRequest() {
  const client = document.getElementById('req-client').value;
  const shipDate = document.getElementById('req-ship-date').value;
  const brewDate = document.getElementById('req-brew-date').value;
  const brewHours = parseFloat(document.getElementById('req-brew-hours').value);
  const reactor = document.getElementById('req-reactor').value;

  if (!client) { showToast('Выберите заказчика'); return; }
  if (!shipDate) { showToast('Укажите дату отгрузки'); return; }
  if (!brewDate) { showToast('Укажите дату варки'); return; }
  if (!brewHours) { showToast('Укажите часы варки'); return; }
  if (!reactor) { showToast('Выберите реактор'); return; }
  if (new Date(brewDate) > new Date(shipDate)) { showToast('Дата варки не может быть позже отгрузки'); return; }

  const itemRows = document.querySelectorAll('#req-items > div');
  const items = [];
  itemRows.forEach(row => {
    const sku = row.querySelector('.req-item-sku').value;
    const qty = parseFloat(row.querySelector('.req-item-qty').value);
    if (sku && qty) items.push({ sku, qty });
  });
  if (!items.length) { showToast('Добавьте хотя бы одну позицию заказа'); return; }

  // conflict check
  const check = checkConflict(reactor, brewDate, brewHours, null);
  if (check.conflict) {
    const ok = confirm(`Реактор ${reactor} на ${fmtDateHuman(brewDate)} уже загружен на ${check.load}ч из ${state.workdayHours}ч. Эта варка (${brewHours}ч) превысит дневной лимит. Создать всё равно?`);
    if (!ok) return;
  }

  const req = mkRequest({ client, items, shipDate, brewDate, brewHours, reactor });
  state.requests.push(req);
  saveState();
  closeModal('modal-request');
  render();
  showToast(`Заявка ${req.id} создана · сформировано ${req.batchIds.length} варок`);
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: ПРЯМАЯ ВАРКА (без заявки)
// ════════════════════════════════════════════════════════════════════════════
function openCreateModal() {
  populateSelects();
  document.getElementById('f-sku').value = '';
  document.getElementById('f-volume').value = '';
  document.getElementById('f-tara').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('f-priority').value = '3';
  document.getElementById('f-brew-date').value = fmtDate(new Date());
  document.getElementById('f-brew-hours').value = '';
  document.getElementById('f-preview').style.display = 'none';
  document.getElementById('f-conflict-note').style.display = 'none';
  document.getElementById('f-buffer-preview').innerHTML = '';
  document.getElementById('modal-create').classList.add('open');
  updateFBufferPreview();
}

function updateFBufferPreview() {
  const date = document.getElementById('f-brew-date').value;
  const reactor = document.getElementById('f-reactor').value;
  const hours = parseFloat(document.getElementById('f-brew-hours').value) || 0;
  const el = document.getElementById('f-buffer-preview');
  if (!date || !reactor) { el.innerHTML = ''; return; }

  const load = getReactorDayLoad(reactor, date, null);
  const free = Math.max(0, state.workdayHours - load);
  const afterTotal = load + hours;
  const overLimit = afterTotal > state.workdayHours;

  el.innerHTML = `<div class="note ${overLimit ? 'note-danger' : 'note-warn'}" style="margin-bottom:10px;">
    <strong>${reactor}</strong> на ${fmtDateHuman(date)}: занято <strong>${load}ч</strong> из ${state.workdayHours}ч ·
    свободно <strong>${free}ч</strong>
    ${hours ? (overLimit
        ? `<br>Превышение лимита дня на ${(afterTotal - state.workdayHours).toFixed(1)}ч`
        : `<br>После этой варки (${hours}ч) останется ${(free - hours).toFixed(1)}ч буфера`)
      : ''}
  </div>`;
}

function onSkuChange() {
  const sku = document.getElementById('f-sku').value;
  const recipe = state.recipes.find(r => r.sku === sku);
  const preview = document.getElementById('f-preview');
  if (recipe) {
    document.getElementById('f-volume').value = recipe.baseBatch;
    document.getElementById('f-tara').value = recipe.tara;
    preview.style.display = 'block';
    preview.innerHTML = `<strong>${recipe.name}</strong><br>${recipe.ingredients.length} компонентов · Базовая партия: ${recipe.baseBatch} кг · Тара: ${recipe.tara} л`;
  } else {
    preview.style.display = 'none';
  }
}

function createBatch() {
  const sku     = document.getElementById('f-sku').value;
  const volume  = parseFloat(document.getElementById('f-volume').value);
  const tara    = parseFloat(document.getElementById('f-tara').value);
  const reactor = document.getElementById('f-reactor').value;
  const priority= parseInt(document.getElementById('f-priority').value);
  const note    = document.getElementById('f-note').value;
  const brewDate = document.getElementById('f-brew-date').value;
  const brewHours = parseFloat(document.getElementById('f-brew-hours').value);

  if (!sku)    { showToast('Выберите продукт'); return; }
  if (!volume) { showToast('Укажите объём партии'); return; }
  if (!tara)   { showToast('Укажите объём тары'); return; }
  if (!brewDate) { showToast('Укажите дату варки'); return; }
  if (!brewHours) { showToast('Укажите часы варки'); return; }
  // Аудит безопасности §3: границы значений — отрицательные объём/тара/часы и даты
  // вне разумного диапазона раньше проходили без проверки (truthy-проверки их не ловят).
  if (volume < 0 || tara < 0 || brewHours < 0) { showToast('Объём, тара и часы варки не могут быть отрицательными'); return; }
  const brewYear = parseInt(String(brewDate).slice(0, 4), 10);
  const nowYear = new Date().getFullYear();
  if (!brewYear || brewYear < nowYear - 1 || brewYear > nowYear + 2) { showToast('Проверьте дату варки — год вне разумного диапазона'); return; }

  const check = checkConflict(reactor, brewDate, brewHours, null);
  if (check.conflict) {
    const ok = confirm(`Реактор ${reactor} на ${fmtDateHuman(brewDate)} уже занят на ${check.load}ч из ${state.workdayHours}ч. Превышение лимита. Создать всё равно?`);
    if (!ok) return;
  }

  const batch = mkBatch({ sku, volume, tara, reactor, priority, status:'planned', note, brewDate, brewHours });
  state.batches.push(batch);
  saveState();
  closeModal('modal-create');
  render();
  showToast(`Варка ${batch.id} создана → ${reactor}`);
}

// ════════════════════════════════════════════════════════════════════════════
// BATCH ACTIONS
// ════════════════════════════════════════════════════════════════════════════
function openBatchActions(id) {
  const b = getBatchById(id);
  // Защита от клика по устаревшему событию (варку успели удалить, а DOM не обновился):
  // не открываем окно мёртвой варки — сообщаем и перерисовываем календарь.
  if (!b || b.status === 'deleted') {
    showToast('Эта варка была удалена — календарь обновлён');
    renderCalendar();
    return;
  }
  const canReschedule = b.status !== 'done' && b.status !== 'deleted' && b.status !== 'cancelled';

  let modal = document.getElementById('modal-actions');
  if (!modal) { modal = document.createElement('div'); modal.id='modal-actions'; modal.className='modal-overlay'; document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); }); }
  modal.innerHTML = `<div class="modal">
    <div class="modal-title">${b.name}</div>
    <div style="font-size:13px; color:var(--text2); margin-bottom:14px;">${b.id} · ${b.volume} кг · ${b.brewHours}ч ${b.requestId?`· ${b.requestId}`:''}</div>
    ${canReschedule ? `
      <div class="grid-2">
        <div class="form-group">
          <label>Дата варки</label>
          <input type="date" id="reschedule-date" value="${b.brewDate}" />
        </div>
        <div class="form-group">
          <label>Реактор</label>
          <select id="reschedule-reactor">
            ${state.reactors.map(r => `<option value="${r}" ${r===b.reactor?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Время начала</label>
        <select id="reschedule-hour">
          <option value="">Авто (по очереди)</option>
          ${Array.from({length: Math.ceil(24 - WORKDAY_START_HOUR) * 4}, (_, i) => WORKDAY_START_HOUR + i * 0.25)
            .filter(h => h < 23.75)
            .map(h => {
              const hh = Math.floor(h), mm = Math.round((h % 1) * 60);
              const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
              const selected = b.scheduledHour !== undefined && b.scheduledHour !== null && Math.abs(b.scheduledHour - h) < 0.01;
              return `<option value="${h}" ${selected ? 'selected' : ''}>${label}</option>`;
            }).join('')}
        </select>
      </div>
      <button class="btn btn-primary btn-full" onclick="rescheduleBatch('${id}')" style="margin-bottom:8px;">💾 Сохранить</button>
    ` : `<div class="note" style="margin-bottom:8px;">Эта варка завершена/отменена — перенос недоступен.</div>`}
    <div style="display:flex; flex-direction:column; gap:8px;">
      <button class="btn btn-danger btn-full" onclick="closeModal('modal-actions'); openDeleteBatchModal('${id}')">🗑 Удалить варку</button>
      <button class="btn btn-ghost btn-full" onclick="closeModal('modal-actions')">Закрыть</button>
    </div>
  </div>`;
  modal.classList.add('open');
}

// Явный перенос варки по дате/реактору/времени — доступен всем ролям с доступом
// к Календарю (включая operator), без права удалять/отменять партию.
function rescheduleBatch(id) {
  const b = getBatchById(id);
  if (!b) return;
  const newDate = document.getElementById('reschedule-date').value;
  const newReactor = document.getElementById('reschedule-reactor').value;
  const hourInput = document.getElementById('reschedule-hour').value;
  const newHour = hourInput === '' ? null : parseFloat(hourInput);

  if (!newDate) { showToast('Укажите дату'); return; }

  if (newHour !== null) {
    const check = checkTimeSlotConflict(newReactor, newDate, newHour, b.brewHours || 0, b.id);
    if (check.conflict) { showToast(`Перенос невозможен: ${check.reason}`); return; }
  } else {
    const check = checkConflict(newReactor, newDate, b.brewHours || 0, b.id);
    if (check.conflict) {
      const ok = confirm(`Реактор ${newReactor} на ${fmtDateHuman(newDate)} уже загружен на ${check.load}ч из ${state.workdayHours}ч. Эта варка (${b.brewHours}ч) превысит лимит. Перенести всё равно?`);
      if (!ok) return;
    }
  }

  const oldDate = b.brewDate, oldReactor = b.reactor;

  b.brewDate = newDate;
  b.reactor = newReactor;
  if (newHour !== null) b.scheduledHour = newHour; else delete b.scheduledHour;

  if (newDate !== oldDate) logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Календарь', page: 'production', pmStage: getBatchStage(b),
    text: `Главный оператор изменил дату варки партии ${b.id}: с ${fmtDateHuman(oldDate)} на ${fmtDateHuman(newDate)}. Источник: Календарь.` });
  if (newReactor !== oldReactor) logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Календарь', page: 'production', pmStage: getBatchStage(b),
    text: `Главный оператор изменил реактор партии ${b.id}: с ${oldReactor} на ${newReactor}. Источник: Календарь.` });

  saveState();
  closeModal('modal-actions');
  render();
  showToast(`${b.id} перенесена на ${fmtDateHuman(newDate)} · ${newReactor}`);
}

function openFinish(id) {
  closeModal('modal-actions');
  const b = getBatchById(id);
  let modal = document.getElementById('modal-finish');
  if (!modal) { modal = document.createElement('div'); modal.id='modal-finish'; modal.className='modal-overlay'; document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); }); }
  modal.innerHTML = `<div class="modal">
    <div class="modal-title">Завершить варку ${b.id}</div>
    <div class="form-group">
      <label>Факт выход (шт)</label>
      <input type="number" id="finish-qty" placeholder="${b.planQty}" value="${b.planQty}" />
    </div>
    <div class="note">ПЛАН: ${b.planQty} шт · Объём: ${b.volume} кг · Тара: ${b.tara} л</div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal('modal-finish')" style="flex:1;">Отмена</button>
      <button class="btn btn-success" onclick="finishBatch('${id}')" style="flex:2;">Сохранить</button>
    </div>
  </div>`;
  modal.classList.add('open');
}

function finishBatch(id) {
  const qty = parseInt(document.getElementById('finish-qty').value);
  // Аудит безопасности §3: без этой проверки NaN/отрицательное значение уходило в
  // factQty напрямую и ломало проценты отклонения и отчёты.
  if (isNaN(qty) || qty < 0) { showToast('Укажите корректное количество (0 и больше)'); return; }
  const b = getBatchById(id);
  b.factQty = qty;
  b.status = 'done';
  saveState();
  closeModal('modal-finish');
  render();
  const dev = ((qty - b.planQty)/b.planQty*100).toFixed(1);
  showToast(`Партия закрыта · Откл.: ${dev > 0 ? '+' : ''}${dev}%`);
}

function setBatchStatus(id, status) {
  const b = getBatchById(id);
  if (b) {
    b.status = status;
    if (status === 'active' && !b.brewStartedAt) b.brewStartedAt = new Date().toISOString();
    saveState(); render(); showToast(`Статус изменён: ${statusLabel(status)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ЗАКЛАДКА (warshchik detail view)
// ════════════════════════════════════════════════════════════════════════════
function openZakladka(id) {
  const b = getBatchById(id);
  if (!b) return;
  state.currentBatchId = id;
  document.getElementById('warshchik-list').style.display = 'none';
  const detail = document.getElementById('warshchik-detail');
  detail.style.display = 'block';
  renderZakladkaDetail(b);
  // Pushstate: перехватываем свайп-назад браузера — назад только через кнопку
  if (isBrewOperatorRole()) {
    document.body.classList.add('terminal-detail-open');
    history.pushState({ terminalTask: id }, '');
  }
}

function renderZakladkaDetail(b) {
  const detail = document.getElementById('warshchik-detail');
  const currentRole = getRoleById(currentUser.roleId);
  const fields = (currentRole && currentRole.fields) || {};
  const canAct = canActOnPage('warshchik');
  const done = b.ingredients.filter((_,i) => b.factIngredients[i] !== undefined).length;
  const total = b.ingredients.length;
  const pct = total ? Math.round(done/total*100) : 0;

  const isRunning = b.status === 'active' && b.brewStartedAt;
  const isDoneBrew = b.status === 'done';
  let startBtnHtml;
  if (isDoneBrew) {
    // Сваренная партия — без действий, только статус (brewed → «Варка завершена»)
    startBtnHtml = `<div style="font-size:15px; font-weight:800; color:var(--accent2);">✓ Варка завершена</div>`;
  } else if (canAct) {
    const incomplete = isRunning && done < total;
    startBtnHtml = isRunning
      ? `<button id="brew-finish-btn" class="btn ${incomplete?'btn-outline-danger':'btn-danger'} btn-full" onclick="stopBrewTimer('${b.id}')">Завершить варку</button>
         <div id="brew-finish-hint" style="margin-top:8px; font-size:12px; font-weight:600; color:var(--danger); ${incomplete?'':'display:none;'}">Заполните сырьё — не введено ${total-done} из ${total}, чтобы завершить варку</div>`
      : `<button class="btn btn-primary btn-full" onclick="startBrewTimer('${b.id}')">Начать варку</button>`;
  } else {
    // режим наблюдения — без кнопок, только статус
    const statusText = b.status === 'done' ? 'Варка завершена' : isRunning ? 'Варка идёт' : 'В очереди на варку';
    startBtnHtml = `<div style="font-size:14px; font-weight:700; color:var(--text2);">${statusText}</div>`;
  }

  // Кнопка «Назад»: у оператора варки она в шапке (на месте «Выйти»),
  // у остальных ролей — встроенная в начало контента.
  const inlineBackBtn = isBrewOperatorRole() ? '' : `
    <button onclick="backToList()" style="display:inline-flex;align-items:center;gap:8px;background:var(--accent);border:none;color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:14px;padding:11px 20px;border-radius:12px;box-shadow:0 4px 12px rgba(59,130,246,.3);">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      Назад
    </button>`;
  detail.innerHTML = `
    ${inlineBackBtn}
    <div class="detail-header">
      <div class="detail-batch-num">${b.id} · ${fmtDateHuman(b.brewDate)} · ${b.reactor}</div>
      <div class="detail-product">${b.name}</div>
      <div class="detail-meta">
        <div class="detail-meta-item">Объём: <span>${b.volume} кг</span></div>
        <div class="detail-meta-item">Тара: <span>${b.tara} л</span></div>
        <div class="detail-meta-item">Выход план: <span>${b.planQty} шт</span></div>
        <div class="detail-meta-item">Время: <span>${b.brewHours} ч</span></div>
        ${fields.priority ? `<div class="detail-meta-item">Приоритет: <span>${priorityLabel(b.priority)}</span></div>` : ''}
        ${fields.client && b.requestId ? `<div class="detail-meta-item">Заявка: <span>${b.requestId}</span></div>` : ''}
      </div>
      ${fields.note && b.note ? `<div class="note" style="margin-top:8px;">📝 ${b.note}</div>` : ''}
      ${b.commentForWarshchik ? `<div class="note" style="margin-top:8px; border-color:var(--accent);">💬 Комментарий от главного оператора: ${b.commentForWarshchik}</div>` : ''}
      <div class="progress-bar-wrap">
        <div class="progress-bar" style="width:${pct}%"></div>
      </div>
      <div style="font-size:12px; color:var(--text2); margin-top:5px;">${done} из ${total} компонентов · ${pct}%</div>
    </div>

    <div class="card" id="brew-timer-card" style="text-align:center;">
      ${startBtnHtml}
      <div id="brew-timer-display" style="margin-top:10px; font-size:13px; color:var(--text2);"></div>
    </div>

    <div class="card" style="padding:0 12px;">
      <div style="padding:10px 0 6px; font-size:11px; color:var(--text2); display:grid; grid-template-columns:16px 1fr 56px 64px; gap:5px; font-weight:600; text-transform:uppercase; letter-spacing:0.3px;">
        <div>#</div><div>Компонент</div><div style="text-align:right;">Норма</div><div style="text-align:center;">Факт</div>
      </div>
      ${b.ingredients.sort((a,c)=>a.order-c.order).map((ing, i) => {
        const isDone = b.factIngredients[i] !== undefined;
        const factVal = isDone ? b.factIngredients[i] : '';
        const factHtml = canAct
          ? `<div style="display:flex;align-items:center;gap:3px;">
               <input type="number" id="ing-input-${i}" value="${factVal}"
                 onchange="saveIngFact(${i})" class="ing-fact-input${isDone?' filled':''}" style="min-width:0;">
               <span style="font-size:11px;color:var(--text2);white-space:nowrap;flex-shrink:0;">${ing.unit}</span>
             </div>`
          : `<div style="text-align:center; font-size:14px; font-weight:700; color:var(--text2);">${factVal || '—'} <span style="font-size:11px">${ing.unit}</span></div>`;
        return `<div class="ingredient-row${isDone ? '' : ' ing-row-missing'}" id="ing-row-${i}" style="${isDone ? 'opacity:0.65;' : ''} display:grid; grid-template-columns:16px 1fr 56px 64px; gap:5px; align-items:center; padding:7px 0;">
          <div class="ing-order" style="font-size:12px; color:var(--text3);">${ing.order}</div>
          <div class="ing-name" style="font-size:14px; line-height:1.2;">${ing.name}</div>
          <div style="text-align:right; font-size:14px; font-weight:700; color:var(--accent); white-space:nowrap;">${ing.normFact}<span style="font-size:11px; color:var(--text2); font-weight:600;"> ${ing.unit}</span></div>
          ${factHtml}
        </div>`;
      }).join('')}
    </div>
  `;

  updateBrewTimerDisplay(b);
}

// Форматирует миллисекунды в "Хч Yмин" — используется и для прошедшего, и для оставшегося времени
function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return `${h}ч ${m}мин`;
}

function updateBrewTimerDisplay(b) {
  const el = document.getElementById('brew-timer-display');
  if (!el) return;
  if (b.status === 'active' && b.brewStartedAt) {
    const elapsedMs = new Date() - new Date(b.brewStartedAt);
    const totalMs = (b.brewHours || 1) * 3600000;
    const remainingMs = totalMs - elapsedMs;
    const startTime = new Date(b.brewStartedAt).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    el.innerHTML = `Начало: <strong>${startTime}</strong> · Прошло: <strong>${formatDuration(elapsedMs)}</strong> · ${remainingMs > 0 ? `Осталось: <strong>${formatDuration(remainingMs)}</strong>` : `<span style="color:var(--warn);">Плановое время истекло</span>`}`;
  } else if (b.status === 'done' && b.brewStartedAt && b.brewEndedAt) {
    const startTime = new Date(b.brewStartedAt).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const endTime = new Date(b.brewEndedAt).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const actualMs = new Date(b.brewEndedAt) - new Date(b.brewStartedAt);
    el.innerHTML = `Начало: <strong>${startTime}</strong> · Конец: <strong>${endTime}</strong> · Фактически заняло: <strong>${formatDuration(actualMs)}</strong>`;
  } else {
    el.textContent = '';
  }
}

function startBrewTimer(id) {
  if (!canDo('startBrewing')) { showToast('Недостаточно прав'); return; }
  const bCheck = getBatchById(id);
  if (!bCheck) return;
  // оператор варки может стартовать только свою назначенную задачу
  if (bCheck.assignedBrewingOperatorRoleId && bCheck.assignedBrewingOperatorRoleId !== currentUser.roleId
      && !((getRoleById(currentUser.roleId)||{}).fullAccess)) {
    showToast('Эта варка назначена другому оператору'); return;
  }
  performCriticalBatchWrite(id, b => {
    b.status = 'active';
    b.brewStartedAt = new Date().toISOString();
  }, {
    onSuccess: (b) => {
      logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок варки', page: 'production', pmStage: 'brewing',
        text: `Оператор варки начал варку партии ${b.id} на реакторе ${b.reactor}.` });
      logActivity('Варка начата', { target: b.id, after: { product: b.name, reactor: b.reactor, startedAt: b.brewStartedAt } });
      renderZakladkaDetail(b);
      showToast(`Варка ${id} началась`);
    }
  });
}

function stopBrewTimer(id) {
  if (!canDo('finishBrewing')) { showToast('Недостаточно прав'); return; }
  const bCheck = getBatchById(id);
  if (!bCheck) return;
  if (bCheck.assignedBrewingOperatorRoleId && bCheck.assignedBrewingOperatorRoleId !== currentUser.roleId
      && !((getRoleById(currentUser.roleId)||{}).fullAccess)) {
    showToast('Эта варка назначена другому оператору'); return;
  }
  // Жёсткая блокировка: без 100% введённого факта по сырью варку завершить нельзя —
  // раньше это никак не проверялось, и партии уходили в "Сварено" с пустым фактом.
  const missing = bCheck.ingredients.map((_,i)=>i).filter(i => bCheck.factIngredients[i] === undefined);
  if (missing.length > 0) {
    showToast(`Заполните все компоненты сырья — не введено: ${missing.length} из ${bCheck.ingredients.length}`);
    missing.forEach(i => document.getElementById(`ing-row-${i}`)?.classList.add('ing-row-missing'));
    document.getElementById(`ing-row-${missing[0]}`)?.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  performCriticalBatchWrite(id, b => {
    b.brewEndedAt = new Date().toISOString();
    b.status = 'done';
    b.sentToBrewing = true; // гарантия: партия попадёт в 'brewed', а не застрянет в 'queued'
    // Если линия розлива уже назначена — передаём в очередь розлива (оператор увидит),
    // но в PM-доске партия остаётся в «Сварено» до нажатия «Начать розлив».
    if (b.pouringLine) {
      b.sentToPouring = true;
      if (!b.pouringDate) b.pouringDate = fmtDate(new Date());
    }
  }, {
    onSuccess: (b) => {
      logActivity('Варка завершена', { target: b.id, after: { product: b.name, reactor: b.reactor, endedAt: b.brewEndedAt } });
      if (b.pouringLine) {
        logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок варки', page: 'production', pmStage: 'brewed',
          text: `Варщик завершил варку партии ${b.id}. Линия «${b.pouringLine}» назначена — ожидает начала розлива оператором.` });
      } else {
        logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок варки', page: 'production', pmStage: 'brewed',
          text: `Варщик завершил варку партии ${b.id}. Ожидает назначения линии розлива.` });
      }
      render();
      showToast(b.pouringLine ? `Варка ${id} завершена — ожидает розлива (${b.pouringLine})` : `Варка ${id} завершена`);
      backToList();
    }
  });
}

// Оператор варки сообщает о проблеме — пишется в журнал событий и activityLog.
function reportBrewProblem(id) {
  if (!canDo('reportBrewProblem')) { showToast('Недостаточно прав'); return; }
  const b = getBatchById(id);
  if (!b) return;
  const text = prompt(`Опишите проблему по партии ${b.id} (${b.name}):`, '');
  if (text === null) return;
  const desc = text.trim() || 'без описания';
  logJournalEvent({ batchId: b.id, batchName: b.name, source: 'Участок варки', page: 'production', pmStage: 'brewing',
    text: `⚠ Оператор варки сообщил о проблеме по партии ${b.id}: ${desc}` });
  logActivity('Проблема на варке', { target: b.id, details: { product: b.name, reactor: b.reactor, problem: desc } });
  saveState();
  showToast('Проблема зафиксирована в журнале');
}

function toggleIngredient(i) {
  if (!canActOnPage('warshchik')) return;
  const b = getBatchById(state.currentBatchId);
  if (!b) return;
  // Ручного ввода факта больше нет — галочка просто отмечает компонент как добавленный
  // по норме (факт = норма).
  if (b.factIngredients[i] !== undefined) {
    delete b.factIngredients[i];
    document.getElementById(`ing-check-${i}`).classList.remove('done');
    document.getElementById(`ing-row-${i}`).style.opacity = '1';
  } else {
    b.factIngredients[i] = b.ingredients[i].normFact;
    document.getElementById(`ing-check-${i}`).classList.add('done');
    document.getElementById(`ing-row-${i}`).style.opacity = '0.6';
  }
  saveState();
  updateZakladkaProgress(b);
}

function saveIngFact(i) {
  if (!canActOnPage('warshchik')) return;
  const b = getBatchById(state.currentBatchId);
  if (!b) return;
  const input = document.getElementById(`ing-input-${i}`);
  const row = document.getElementById(`ing-row-${i}`);
  const val = parseFloat(input.value);
  if (!isNaN(val) && val >= 0) {
    b.factIngredients[i] = val;
    if (row) { row.style.opacity = '0.65'; row.classList.remove('ing-row-missing'); }
    if (input) input.classList.add('filled');
  } else {
    delete b.factIngredients[i];
    if (row) { row.style.opacity = '1'; row.classList.add('ing-row-missing'); }
    if (input) input.classList.remove('filled');
  }
  saveState();
  updateZakladkaProgress(b);
}

function updateZakladkaProgress(b) {
  const done = Object.keys(b.factIngredients).length;
  const total = b.ingredients.length;
  const pct = total ? Math.round(done/total*100) : 0;
  const bar = document.querySelector('.progress-bar');
  const lbl = document.querySelector('.progress-bar-wrap + div');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = `${done} из ${total} компонентов · ${pct}%`;

  // Кнопка «Завершить варку» и подсказка под ней — без полного ре-рендера
  // (иначе слетал бы фокус с инпута, в который оператор только что ввёл значение).
  const btn = document.getElementById('brew-finish-btn');
  const hint = document.getElementById('brew-finish-hint');
  if (btn) {
    const incomplete = done < total;
    btn.classList.toggle('btn-outline-danger', incomplete);
    btn.classList.toggle('btn-danger', !incomplete);
  }
  if (hint) {
    hint.style.display = done < total ? '' : 'none';
    hint.textContent = `Заполните сырьё — не введено ${total-done} из ${total}, чтобы завершить варку`;
  }
}

function backToList() {
  state.currentBatchId = null;
  document.body.classList.remove('terminal-detail-open');
  document.getElementById('warshchik-detail').style.display = 'none';
  document.getElementById('warshchik-list').style.display = 'block';
  render();
}

// Универсальная кнопка «Назад» в шапке терминала — закрывает открытое задание
function terminalBack() {
  const intakeDetail = document.getElementById('intake-detail');
  if (intakeDetail && intakeDetail.style.display !== 'none') { backToIntakeList(); return; }
  backToList();
}

// ════════════════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════════════════
const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOW_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

function calShiftMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  renderCalendar();
}

function renderCalendar() {
  const dowRow = document.getElementById('cal-dow-row');
  if (!dowRow) return;
  dowRow.innerHTML = DOW_NAMES.map(d => `<div class="cal-dow">${d}</div>`).join('');

  document.getElementById('cal-month-label').textContent = `${MONTH_NAMES[state.calMonth]} ${state.calYear}`;

  const firstDay = new Date(state.calYear, state.calMonth, 1);
  const lastDay = new Date(state.calYear, state.calMonth + 1, 0);
  let startOffset = firstDay.getDay() - 1; // Monday = 0
  if (startOffset < 0) startOffset = 6;

  const today = fmtDate(new Date());
  const grid = document.getElementById('cal-grid');
  let cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="cal-day empty"></div>');

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateIso = fmtDate(new Date(state.calYear, state.calMonth, day));
    const dayBatches = state.batches.filter(b => b.brewDate === dateIso && b.status !== 'cancelled' && b.status !== 'deleted');
    const totalHoursAllReactors = dayBatches.reduce((s,b)=>s+(b.brewHours||0),0);
    const maxPossible = state.reactors.length * state.workdayHours;
    const loadPct = maxPossible ? Math.min(100, Math.round(totalHoursAllReactors / maxPossible * 100)) : 0;
    const isToday = dateIso === today;
    const isSelected = dateIso === state.calSelectedDate;

    cells.push(`<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}" data-date-cell="${dateIso}" onclick="selectCalDay('${dateIso}')">
      <div class="cal-day-num">${day}</div>
      ${dayBatches.length ? `
        <div class="cal-load-bar"><div class="cal-load-fill" style="width:${loadPct}%; background:${loadPct>=90?'var(--danger)':loadPct>=60?'var(--warn)':'var(--accent2)'};"></div></div>
        <div class="cal-day-hours">${totalHoursAllReactors}ч занято</div>
        <div class="cal-day-batches">
          ${dayBatches.slice(0,2).map(b => `<div class="cal-mini-batch" style="background:var(--r${reactorColor(b.reactor)});">${b.reactor}: ${b.name.substring(0,12)}</div>`).join('')}
          ${dayBatches.length > 2 ? `<div style="font-size:9px; color:var(--text2);">+${dayBatches.length-2} ещё</div>` : ''}
        </div>
      ` : ''}
    </div>`);
  }
  grid.innerHTML = cells.join('');

  if (state.calSelectedDate) renderCalDayDetail(state.calSelectedDate);
}

function selectCalDay(dateIso) {
  state.calSelectedDate = dateIso;
  renderCalendar();
}

function renderCalDayDetail(dateIso) {
  const el = document.getElementById('cal-day-detail');
  const dayBatches = state.batches.filter(b => b.brewDate === dateIso && b.status !== 'cancelled' && b.status !== 'deleted');

  // фиксированный диапазон сетки: 08:00–20:00. Если из-за перегруза реактора
  // варки выходят за 20:00, сетка растягивается, чтобы их всё равно показать.
  const FIXED_END_HOUR = 20;
  let maxEndHour = FIXED_END_HOUR;
  state.reactors.forEach(r => {
    const sched = computeReactorSchedule(r, dateIso);
    sched.forEach(s => { if (s.endHour > maxEndHour) maxEndHour = s.endHour; });
  });
  const totalHoursSpan = Math.ceil(maxEndHour) - WORKDAY_START_HOUR;
  const hourRowHeight = 44; // px per hour

  const hourLabels = Array.from({length: totalHoursSpan + 1}, (_, i) => WORKDAY_START_HOUR + i);

  el.innerHTML = `<div class="cal-day-detail">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
      <div style="font-size:15px; font-weight:700;">${fmtDateHuman(dateIso)}</div>
      <div style="font-size:12px; color:var(--text2);">Рабочий день: ${state.workdayHours}ч на реактор · старт ${String(WORKDAY_START_HOUR).padStart(2,'0')}:00</div>
    </div>

    <div class="day-grid-wrap">
      <div class="day-grid" style="grid-template-columns: 48px repeat(${state.reactors.length}, 1fr);">
        <!-- header row: empty corner + reactor names -->
        <div class="day-grid-corner" style="grid-column:1; grid-row:1;"></div>
        ${state.reactors.map((r,ri) => `<div class="day-grid-reactor-header" style="grid-column:${ri+2}; grid-row:1;"><div class="reactor-badge rc-${ri+1}" style="width:26px;height:26px;font-size:10px; margin:0 auto;">${r.replace('Р-','')}</div></div>`).join('')}

        <!-- hour rows -->
        <div class="day-grid-hours" style="grid-column:1; grid-row:2; height:${totalHoursSpan * hourRowHeight}px;">
          ${hourLabels.map((h,i) => i < hourLabels.length-1 ? `<div class="day-grid-hour-label" style="height:${hourRowHeight}px;">${String(h).padStart(2,'0')}:00</div>` : '').join('')}
        </div>

        ${state.reactors.map((r, ri) => {
          const sched = computeReactorSchedule(r, dateIso);
          const usedHours = sched.reduce((s,x)=>s+(x.batch.brewHours||0),0);
          const overLimit = usedHours > state.workdayHours;
          return `<div class="day-grid-col" data-reactor="${r}" data-date="${dateIso}"
            style="grid-column:${ri+2}; grid-row:2; height:${totalHoursSpan * hourRowHeight}px;">
            ${hourLabels.slice(0,-1).map(() => `<div class="day-grid-hour-cell" style="height:${hourRowHeight}px;"></div>`).join('')}
            ${sched.map(({batch:b, startHour, endHour}) => {
              const top = (startHour - WORKDAY_START_HOUR) * hourRowHeight;
              const height = Math.max(20, (endHour - startHour) * hourRowHeight - 2);
              const sH = Math.floor(startHour), sM = Math.round((startHour%1)*60);
              const eH = Math.floor(endHour), eM = Math.round((endHour%1)*60);
              const canMove = b.status !== 'done' && b.status !== 'deleted' && b.status !== 'cancelled';
              return `<div class="day-grid-event" style="top:${top}px; height:${height}px; background:var(--r${reactorColor(r)}); cursor:pointer;"
                data-batch-id="${b.id}"
                onclick="openBatchActions('${b.id}')"
                title="${b.name} · ${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')}–${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}">
                <div class="day-grid-event-time">${String(sH).padStart(2,'0')}:${String(sM).padStart(2,'0')}–${String(eH).padStart(2,'0')}:${String(eM).padStart(2,'0')}</div>
                <div class="day-grid-event-name">${b.name}</div>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div style="display:flex; gap:14px; margin-top:10px; flex-wrap:wrap;">
      ${state.reactors.map((r,ri) => {
        const sched = computeReactorSchedule(r, dateIso);
        const usedHours = sched.reduce((s,x)=>s+(x.batch.brewHours||0),0);
        const overLimit = usedHours > state.workdayHours;
        return `<div style="font-size:12px; color:${overLimit?'var(--danger)':'var(--text2)'};">${r}: ${usedHours}/${state.workdayHours}ч ${overLimit?'[перегруз]':''}</div>`;
      }).join('')}
    </div>

    ${!dayBatches.length ? '<div class="note" style="margin-top:10px;">На этот день нет запланированных варок — полный буфер на всех реакторах.</div>' : ''}
  </div>`;
}

;

// ════════════════════════════════════════════════════════════════════════════
// MODAL UTILS — close on backdrop click
// ════════════════════════════════════════════════════════════════════════════
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  // Локальный логин Manufacture в приоритете — синхронно, без сети.
  let restored = tryRestoreSession();
  let ssoPromise = null;
  if (!restored) {
    const portalToken = localStorage.getItem('portal_token');
    if (portalToken) {
      // Оптимистично: выставляем токен-кандидат СРАЗУ и запускаем loadState() с ним
      // параллельно с /whoami, не дожидаясь отдельного подтверждения — сервер и так
      // валидирует тот же токен внутри requireAuth()/verifyPortalToken() при запросе
      // /state (общий код storage.php). /whoami нужен отдельно только за именем и
      // ролью для шапки/меню — эти данные не блокируют получение самого state.
      // Раньше это были три сетевых круга подряд (report → whoami → state), из-за
      // чего SSO-вход держал экран "Подключение..." заметно дольше локального логина.
      authToken = portalToken;
      ssoPromise = trySso();
    }
  }

  await Promise.all([initFirebase(), loadState()]);

  if (ssoPromise) {
    const ssoOk = await ssoPromise;
    if (ssoOk) {
      restored = true;
    } else if (!restored) {
      // Токен-кандидат оказался невалиден — если loadState() ещё не сделал этого
      // сам через 401 → handleAuthExpired(), подчищаем явно, чтобы не остаться
      // молча залогиненными по неподтверждённому токену.
      authToken = null;
      currentUser = null;
    }
  }

  applyTheme();
  document.getElementById('loading-screen').style.display = 'none';

  // Баннер если сервер недоступен
  if (_firebaseError || !_fbReady) {
    const banner = document.createElement('div');
    banner.id = 'firebase-error-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;text-align:center;padding:10px 16px;font-size:13px;font-weight:600;';
    banner.innerHTML = '⚠️ Сервер недоступен — данные не синхронизируются. Работаете офлайн. Обновите страницу или проверьте соединение.';
    document.body.prepend(banner);
  }

  // authToken мог обнулиться внутри loadState (401 → handleAuthExpired) —
  // тогда экран входа уже показан, в приложение не входим.
  if (restored && authToken && currentUser) {
    enterApp();
    if (_fbReady) setupFirestoreSync();
    migrateLegacyLogo();
  } else {
    // Единый вход платформы (решение владельца 2026-07-21): без сессии и без
    // успешного SSO своей формы входа нет — сразу на портал varka.kz.
    window.location.replace('https://varka.kz/');
  }
})();

// Клик вне карточек реактора — снимаем выбор
document.addEventListener('click', function(e) {
  if (state.filterReactor !== 'all') {
    const tabs = document.getElementById('reactor-tabs');
    const panel = document.getElementById('reactor-info-panel');
    if (!(tabs && tabs.contains(e.target)) && !(panel && panel.contains(e.target))) {
      if (_reactorDeselectTimer) { clearTimeout(_reactorDeselectTimer); _reactorDeselectTimer = null; }
      state.filterReactor = 'all';
      renderWarshchikBatches();
      renderReactorInfoPanel();
    }
  }
  if (state.filterPouringLine && state.filterPouringLine !== 'all') {
    const tabs = document.getElementById('intake-line-tabs');
    const panel = document.getElementById('pouring-line-info-panel');
    if (!(tabs && tabs.contains(e.target)) && !(panel && panel.contains(e.target))) {
      if (_lineDeselectTimer) { clearTimeout(_lineDeselectTimer); _lineDeselectTimer = null; }
      state.filterPouringLine = 'all';
      renderIntake();
      renderPouringLineInfoPanel();
    }
  }
  // Клик по пустому месту в «Управлении производством» — снимаем выбор стадии.
  // НЕ срабатывает при клике на сами карточки-статусы или на список партий
  // (чтобы можно было раскрывать карточки партий, не теряя выбранную стадию).
  if (_pmStage) {
    const tabs = document.getElementById('pm-stage-tabs');
    const inTabs = tabs && tabs.contains(e.target);
    // Клик по карточке партии (раскрытие/форма) — выбор НЕ снимаем.
    // Клик по пустому месту, по «Пусто» или между карточками — снимаем.
    const onBatchCard = e.target.closest && e.target.closest('#pm-content .card, #pm-content .batch-card');
    if (!inTabs && !onBatchCard) {
      _pmStage = '';
      try { sessionStorage.setItem('pmStage', ''); } catch(_) {}
      document.querySelectorAll('#pm-stage-tabs .reactor-card').forEach(b => b.classList.remove('active'));
      renderPmContent();
    }
  }
});

// Часы в шапке
(function startClock() {
  function tick() {
    const el = document.getElementById('nav-clock-time');
    if (!el) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
})();

// ════════════════════════════════════════════════════════════════════════════
// CROSS-TAB SYNC — когда варщик/оператор сохраняет данные в одной вкладке,
// PM и оператор розлива в других вкладках сразу видят изменения.
// ════════════════════════════════════════════════════════════════════════════
window.addEventListener('storage', function(e) {
  if (e.key !== 'varka_state_v2' || !currentUser || !e.newValue) return;
  // Не синхронизируем если варщик открыл закладку с вводом — чтобы не сбросить форму
  const detailOpen = document.getElementById('warshchik-detail')?.style.display !== 'none';
  if (detailOpen) return;
  try {
    const s = JSON.parse(e.newValue);
    if (!s) return;
    // Сохраняем локальные UI-состояния этой вкладки (фильтры, даты, открытые вкладки)
    const keep = {
      pmDate: state.pmDate, pmShowAll: state.pmShowAll,
      filterReactor: state.filterReactor, filterPouringLine: state.filterPouringLine,
      intakeDate: state.intakeDate, intakeShowAll: state.intakeShowAll,
      warshchikViewDate: state.warshchikViewDate, warshchikViewingHistory: state.warshchikViewingHistory,
      currentBatchId: state.currentBatchId, theme: state.theme
    };
    state = { ...s, ...keep };
    // Единая миграция (включая новые поля assigned-стадии) для партий из другой вкладки
    applyStateMigrations();
  } catch(e2) {}
  // применяем чужое обновление без обратной записи (иначе пинг-понг между вкладками)
  _applyingRemoteState = true;
  try { render(); } finally { _applyingRemoteState = false; }
});

// Живое обновление индикатора заполнения реактора (имитация по времени) —
// перерисовываем только список варок варщика, чтобы не сбрасывать ввод
// на других открытых экранах (например, поля факта сырья в открытой закладке).
setInterval(() => {
  if (!currentUser) return;
  const warshchikPageActive = document.getElementById('page-warshchik')?.classList.contains('active');
  const onListView = document.getElementById('warshchik-list')?.style.display !== 'none';
  if (warshchikPageActive && onListView) renderWarshchikBatches();
}, 15000);

// Живое обновление текста таймера внутри открытой закладки — обновляем только
// текстовый блок, не весь DOM, чтобы не сбросить ввод в полях факта сырья.
setInterval(() => {
  if (!currentUser || !state.currentBatchId) return;
  const detailVisible = document.getElementById('warshchik-detail')?.style.display !== 'none';
  if (!detailVisible) return;
  const b = getBatchById(state.currentBatchId);
  if (b) updateBrewTimerDisplay(b);
}, 1000);

// Живое обновление секундомера розлива (нет известной плановой длительности —
// просто растущий счётчик "сколько времени идёт"), без перерисовки всего списка.
setInterval(() => {
  if (!currentUser) return;
  const intakePageActive = document.getElementById('page-intake')?.classList.contains('active');
  if (!intakePageActive) return;
  state.batches.filter(b => b.pouringStartedAt && !b.pouringEndedAt).forEach(b => {
    const elDisplay = document.getElementById(`pouring-timer-${b.id}`);
    if (elDisplay) elDisplay.textContent = `Идёт: ${formatDuration(new Date() - new Date(b.pouringStartedAt))}`;
  });
}, 1000);

// Возвращает открытый детальный overlay терминала (варка или розлив), либо null
function _openTerminalDetail() {
  const wd = document.getElementById('warshchik-detail');
  if (wd && wd.style.display !== 'none') return wd;
  const id = document.getElementById('intake-detail');
  if (id && id.style.display !== 'none') return id;
  return null;
}

// Блокировка свайпа-назад и pull-to-refresh для терминальных ролей (варка/розлив)
let _touchStartY = 0, _touchStartX = 0;
document.addEventListener('touchstart', function(e) {
  if (!isTerminalRole()) return;
  _touchStartY = e.touches[0].clientY;
  _touchStartX = e.touches[0].clientX;
  // Слой 1: перехват левого края (iOS Safari swipe-back) в режиме задания
  const detail = _openTerminalDetail();
  if (detail && e.touches[0].clientX <= 25) e.preventDefault();
}, { passive: false });

// Слой 2: блокировка pull-to-refresh — если тянут вниз, а скролл-контейнер уже наверху
document.addEventListener('touchmove', function(e) {
  if (!isTerminalRole()) return;
  const dy = e.touches[0].clientY - _touchStartY;
  if (dy <= 0) return; // тянут вверх — обычный скролл, не мешаем
  const scroller = _openTerminalDetail() || document.querySelector('body.role-terminal .app-main');
  if (scroller && scroller.scrollTop <= 0) e.preventDefault(); // наверху + тянут вниз → не даём pull-to-refresh
}, { passive: false });

// Слой 3: popstate — если браузер всё же поп-нул state, возвращаемся обратно
window.addEventListener('popstate', function() {
  if (!isTerminalRole()) return;
  if (_openTerminalDetail()) {
    history.pushState({ terminalTask: state.currentBatchId }, '');
    terminalBack();
  }
});

// Мобильная клавиатура: при открытии клавиатуры сдвигаем нижнюю границу
// детального overlay (варка/розлив) так, чтобы список сырья оставался скроллируемым
function _adjustTerminalDetailForKeyboard() {
  const detail = _openTerminalDetail();
  if (!detail) return;
  const vv = window.visualViewport;
  if (!vv) return;
  // Высота клавиатуры = разница между высотой окна и видимым viewport
  const kbHeight = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
  detail.style.bottom = kbHeight ? kbHeight + 'px' : '';
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', _adjustTerminalDetailForKeyboard);
  window.visualViewport.addEventListener('scroll', _adjustTerminalDetailForKeyboard);
}
