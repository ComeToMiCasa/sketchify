// The cascade layer `@sketchify base` writes into (M7a). On its own, so that modules reading the
// tree (warnings) can tell the base's rules from the page's without importing the emitters.

/** Unlayered styles beat every layer, whatever their specificity. */
export const BASE_LAYER = 'sketchify-base';
