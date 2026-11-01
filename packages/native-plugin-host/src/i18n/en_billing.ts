// Extracted from apps/desktop/src/i18n/en_billing.ts at 1f08da749c65f511667b02eacb5b8ed46a2f8c04 (MIT).
import type { BillingTranslations } from '../../../plugin-sdk/src/i18n/types_billing'

// Out-of-credits overlay copy (Nous vs. third-party providers), spread into en.ts.
export const enBilling: BillingTranslations = {
  billingBlock: {
    titleNous: 'Out of Nous credits',
    titleProvider: provider => `Out of credits — ${provider}`,
    fallbackMessage: 'Your account is out of credits. Add credits to keep going.',
    openBilling: 'Open billing',
    addCredits: 'Add credits',
    dismiss: 'Dismiss'
  }
}
