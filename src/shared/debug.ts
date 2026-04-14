const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

export const DEBUG_MODE = TRUE_VALUES.has((import.meta.env.VITE_DEBUG_MODE ?? '').toLowerCase())
