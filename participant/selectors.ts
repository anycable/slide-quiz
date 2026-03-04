/**
 * Shared class-name constants for the participant widget.
 *
 * Only classes used in both DOM construction and querySelector/classList
 * calls need to be here. Template-only classes are fine as raw strings.
 */

export const CLS = {
  participant: "lq-participant",
  sectionHidden: "lq-participant__section--hidden",
  status: "lq-participant__status",
  input: "lq-participant__input",
  submit: "lq-participant__submit",
  btn: "lq-participant__btn",
  btnSelected: "lq-participant__btn--selected",
  btnFaded: "lq-participant__btn--faded",
} as const;
