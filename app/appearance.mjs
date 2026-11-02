/** Appearance preferences shared by the main process and local renderer. */

/** Fresh installations use solid surfaces and follow the operating system. */
export const defaultAppearance = 'system'
export const defaultTheme = 'system'

/** One glass transparency percentage; text remains opaque. */
export const defaultTransparency = 85

/**
 * @param {unknown} mode Candidate appearance identifier.
 * @returns {boolean} Whether the identifier is supported.
 */
export function isAppearance(mode) {
  return mode === 'liquid' || mode === 'frosted' || mode === 'system'
}

/**
 * @param {unknown} theme Candidate shared color preference.
 * @returns {boolean} Whether it follows the system or selects a manual tone.
 */
export function isTheme(theme) {
  return theme === 'system' || theme === 'light' || theme === 'dark'
}

/**
 * @param {'system'|'light'|'dark'} theme Saved color preference shared by all materials.
 * @param {'light'|'dark'} systemTheme Current operating-system appearance.
 * @returns {'light'|'dark'} Tone to render without changing the saved preference.
 */
export function resolveTheme(theme, systemTheme) {
  return theme === 'system' ? systemTheme : theme
}

/**
 * @param {unknown} value Candidate transparency percentage.
 * @returns {boolean} Whether the percentage is an integer between zero and one hundred.
 */
export function isTransparencyValue(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100
}

/**
 * Migrates old separate colors and sliders using the active material's preference.
 * For old solid mode, retain its color and prefer the saved liquid percentage.
 * Invalid stored values fail rather than silently replacing the user's choices.
 * @param {unknown} input Parsed preference file, or undefined for a fresh installation.
 * @returns {{appearance: 'liquid'|'frosted'|'system', theme: 'system'|'light'|'dark', transparency: number}} Shared material, color and percentage preferences.
 */
export function normalizeAppearancePreferences(input) {
  if (input === undefined) return { appearance: defaultAppearance, theme: defaultTheme, transparency: defaultTransparency }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('窗口外观配置无效')
  const appearance = input.appearance === 'white' ? 'system' : input.appearance === undefined ? defaultAppearance : input.appearance
  if (!isAppearance(appearance)) throw new Error('请选择有效的窗口外观')
  if (input.glassTone !== undefined && input.glassTone !== 'light' && input.glassTone !== 'dark') throw new Error('请选择浅色或深色玻璃')
  if (input.solidTheme !== undefined && !isTheme(input.solidTheme)) throw new Error('请选择跟随系统、浅色或深色')
  const theme = input.theme === undefined ? appearance === 'system' ? input.solidTheme ?? defaultTheme : input.glassTone ?? 'light' : input.theme
  if (!isTheme(theme)) throw new Error('请选择跟随系统、浅色或深色')
  let transparency = input.transparency === undefined ? defaultTransparency : input.transparency
  if (input.transparency !== undefined && typeof input.transparency === 'object') {
    if (!input.transparency || Array.isArray(input.transparency)) throw new Error('玻璃透明度配置无效')
    for (const mode of ['liquid', 'frosted']) {
      if (input.transparency[mode] !== undefined && !isTransparencyValue(input.transparency[mode])) throw new Error('玻璃透明度须为 0 到 100 的整数')
    }
    transparency = appearance === 'frosted' ? input.transparency.frosted ?? input.transparency.liquid ?? defaultTransparency : input.transparency.liquid ?? input.transparency.frosted ?? defaultTransparency
  }
  if (!isTransparencyValue(transparency)) throw new Error('玻璃透明度须为 0 到 100 的整数')
  return { appearance, theme, transparency }
}
