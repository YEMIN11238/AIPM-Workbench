/** Public branding keeps the existing macOS encryption namespace and stored user data compatible. */
export const productName = 'ORVYN'

/** Rename the UI after Electron initializes Safe Storage with the existing application name. */
export function configureApplicationBrand(app) {
  // Electron captures the name for Keychain before ready; changing it here would orphan saved credentials.
  app.setName('AIPM 工作台')
  app.once('ready', () => app.setName(productName))
}
