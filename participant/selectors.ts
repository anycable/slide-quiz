/**
 * Shared class-name constants for the participant widget.
 *
 * Only classes used in both DOM construction and querySelector/classList
 * calls need to be here. Template-only classes are fine as raw strings.
 */

export const CLS = {
  participant: "sq-participant",
  sectionHidden: "sq-participant__section--hidden",
  status: "sq-participant__status",
  input: "sq-participant__input",
  submit: "sq-participant__submit",
  btn: "sq-participant__btn",
  btnSelected: "sq-participant__btn--selected",
  btnFaded: "sq-participant__btn--faded",
} as const;
