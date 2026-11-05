// orvo plus and premium: one subscription for every orvo service.
// Shared by the site and the server, and copied into each service as the source of limits.
export const PLANS = {
  free: { id: 'free', name: 'Бесплатно', price: 0 },
  plus: {
    id: 'plus', name: 'orvo plus', short: 'plus', price: 299,
    perks: [
      'Сквозь без ограничения по времени, до 5 устройств',
      'Полка: 60 запросов к ИИ в день и 2 ГБ под файлы',
      'Норма: 40 оценок блюд по фото в день',
      'Знак plus в профиле orvo ID'
    ]
  },
  premium: {
    id: 'premium', name: 'orvo premium', short: 'premium', price: 599,
    perks: [
      'Всё, что есть в plus',
      'Сквозь: до 10 устройств',
      'Полка: 200 запросов к ИИ в день и 10 ГБ',
      'Норма: 150 оценок в день и первым новые сервисы'
    ]
  }
};

// What each service gives on each plan. Services enforce these numbers themselves.
export const LIMITS = {
  skvoz: { free: { devices: 5, trialDays: 3 }, plus: { devices: 5 }, premium: { devices: 10 } },
  polka: { free: { aiPerDay: 15, storageMb: 300 }, plus: { aiPerDay: 60, storageMb: 2048 }, premium: { aiPerDay: 200, storageMb: 10240 } },
  norma: { free: { aiPerDay: 5 }, plus: { aiPerDay: 40 }, premium: { aiPerDay: 150 } }
};

export const RANK = { free: 0, plus: 1, premium: 2 };
