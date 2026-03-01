import type { UiTone } from "./components.js";

export type UiStatusCopy = {
  label: string;
  tone: UiTone;
};

const ACCESS_REQUEST_STATUS_COPY: Record<string, UiStatusCopy> = {
  new: { label: "Новая", tone: "info" },
  contacted: { label: "Связались", tone: "warning" },
  approved: { label: "Одобрена", tone: "success" },
  rejected: { label: "Отклонена", tone: "danger" },
};

const USER_STATUS_COPY: Record<string, UiStatusCopy> = {
  active: { label: "Активен", tone: "success" },
  disabled: { label: "Отключён", tone: "danger" },
};

const USER_ROLE_COPY: Record<string, UiStatusCopy> = {
  admin: { label: "Администратор", tone: "warning" },
  user: { label: "Пользователь", tone: "info" },
};

const FILE_STATUS_COPY: Record<string, UiStatusCopy> = {
  queued: { label: "В очереди", tone: "warning" },
  uploaded: { label: "В очереди", tone: "warning" },
  processing: { label: "В обработке", tone: "info" },
  succeeded: { label: "Готово", tone: "success" },
  failed: { label: "Ошибка", tone: "danger" },
};

export const UI_COPY = {
  common: {
    retry: "Повторить",
    email: "Эл. почта",
    emailLower: "эл. почту",
    appBackAction: "Вернуться в приложение",
    featureInDevelopment: "Функция в разработке.",
    inDevelopmentShort: "В разработке",
  },
  placeholder: {
    title: "Раздел в разработке",
    description: "Интерфейс страницы пока недоступен.",
  },
} as const;

export const REPORT_UI_COPY = {
  title: "Отчёт по созвону",
  typePrefix: "Тип",
  noData: "Данные отчёта отсутствуют.",
  untitledSection: "Раздел",
  unknownField: "Поле",
  untitledItem: "Пункт",
  sectionCountSuffix: "блоков",
  itemCountSuffix: "элементов",
  summaryFallback: "Структурированный отчёт по встрече.",
  sourcePrefix: "Источник",
  schemaPrefix: "Схема",
  expandAll: "Развернуть всё",
  collapseAll: "Свернуть всё",
  print: "Печать",
  detailsCountPrefix: "Пунктов",
  sectionOrder: ["meta", "passport", "deal_track", "pilot_poc", "product_track"],
  sectionLabels: {
    meta: "Мета",
    passport: "Паспорт сделки",
    deal_track: "Трек сделки",
    pilot_poc: "Пилот / проверка концепции",
    product_track: "Продуктовый трек",
  },
  fieldLabels: {
    schema_version: "Версия схемы",
    source: "Источник",
    transcript_id: "ID транскрипта",
    transcript_format: "Формат транскрипта",
    has_diarization: "Диаризация",
    has_timecodes: "Таймкоды",
    language: "Язык",
    meeting_type: "Тип встречи",
    primary: "Основной тип",
    secondary: "Дополнительные типы",
    label: "Метка",
    focus_weights: "Фокус-веса",
    signals: "Сигналы",
    text: "Текст",
    evidence: "Основание",
    quote: "Цитата",
    timecode: "Таймкод",
    loc: "Позиция",
    start: "Начало",
    end: "Конец",
    source_id: "ID источника",
    company: "Компания",
    name: "Название",
    group: "Группа",
    industry: "Индустрия",
    contacts: "Контакты",
    person: "Контакт",
    role: "Роль",
    offering: "Предложение",
    primary_theme: "Основная тема",
    solution_candidates: "Кандидаты решения",
    stage: "Стадия",
    value: "Значение",
    status: "Статус",
    confidence: "Уверенность",
    mode: "Режим",
    items: "Пункты",
    missing_questions: "Недостающие вопросы",
    alternatives: "Альтернативы",
    roles: "Роли",
    decision_maker: "ЛПР",
    champion: "Чемпион",
    owner: "Ответственный",
    blocker: "Блокер",
    process: "Процесс",
    cadence: "Ритм",
    next_contact: "Следующий контакт",
    deliverable: "Результат",
    budget: "Бюджет",
    unit_economics: "Юнит-экономика",
    procurement: "Закупка",
    price_sensitivity: "Чувствительность к цене",
    commitments: "Коммитменты",
    action: "Действие",
    when: "Срок",
    actor: "Участник",
    next_step: "Следующий шаг",
    what: "Что",
    goal: "Цель",
    security_compliance_data: "Безопасность и комплаенс",
    problem_impact: "Проблема и эффект",
    value_hypothesis: "Гипотеза ценности",
    decision_people: "Решающие лица",
    timing_trigger: "Сроки и триггеры",
    money_procurement: "Бюджет и закупка",
    momentum_next_step: "Динамика и следующий шаг",
    pilot_poc: "Пилот / PoC",
    inputs_from_client: "Входы от клиента",
    outputs_from_vendor: "Выходы от поставщика",
    success_criteria: "Критерии успеха",
    timeline_checkpoints: "Контрольные точки",
    owners: "Владельцы",
    client_owner: "Владелец со стороны клиента",
    vendor_owner: "Владелец со стороны поставщика",
    use_case: "Сценарий использования",
    requirements: "Требования",
    functional: "Функциональные",
    non_functional: "Нефункциональные",
    data_integrations: "Интеграции данных",
    constraints: "Ограничения",
    implementation: "Реализация",
    open_questions_risks: "Открытые вопросы и риски",
  },
  enumLabels: {
    high: "Высокая",
    medium: "Средняя",
    low: "Низкая",
    present: "Есть",
    missing: "Отсутствует",
    not_discussed: "Не обсуждалось",
    uncertain: "Неопределённо",
    explicit: "Явно",
    inferred: "Выведено",
    lead: "Лид",
    discovery: "Выявление потребности",
    demo_workshop: "Демо / воркшоп",
    proposal: "Коммерческое предложение",
    negotiation: "Переговоры",
    procurement: "Закупка",
    closed_won: "Выиграна",
    closed_lost: "Проиграна",
    tech_debug: "Техническая сессия",
    commercial: "Коммерческая сессия",
    exec_alignment: "Синхронизация руководства",
    client: "Клиент",
    vendor: "Поставщик",
    unknown: "Не указано",
    txt: "TXT",
    vtt: "VTT",
    other: "Другой",
  },
} as const;

export function toAccessRequestStatusCopy(status: string): UiStatusCopy {
  return ACCESS_REQUEST_STATUS_COPY[status] ?? { label: status || "—", tone: "info" };
}

export function toUserStatusCopy(status: string): UiStatusCopy {
  return USER_STATUS_COPY[status] ?? { label: status || "—", tone: "info" };
}

export function toUserRoleCopy(role: string): UiStatusCopy {
  return USER_ROLE_COPY[role] ?? { label: role || "—", tone: "info" };
}

export function toFileStatusCopy(status: string): UiStatusCopy {
  return FILE_STATUS_COPY[status] ?? { label: status || "—", tone: "info" };
}
