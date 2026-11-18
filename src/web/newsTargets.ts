/**
 * Screen elements the "show me what is new" tour can point at. A release note names one by key
 * (`show`); only the latest two releases may use it, because old selectors break as the screen changes.
 * `reveal`: the element is hidden until some condition, so the tour shows it for the duration of the step.
 */
export interface NewsTarget {
  selector: string;
  reveal?: boolean;
}

export const NEWS_TARGETS: Record<string, NewsTarget> = {
  selftest: { selector: '[data-check-row="selftest"]' },
  stremio: { selector: '[data-check-row="stremio"]' },
  askToggle: { selector: '#q-ask-box' },
  tryAnother: { selector: '#st-try-another', reveal: true },
};
