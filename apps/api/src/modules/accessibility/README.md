# accessibility

Accessibility QA policies, findings and WCAG-oriented evaluation.

Owned by the developer working on `feat/accessibility`.

- `domain` holds entities, value objects and domain policies.
- `application` holds use cases and the narrow ports those use cases need.
- `infrastructure` implements ports using persistence, AI or browser tools.
- `presentation` adapts HTTP requests and responses to use cases.

Add an `index.ts` public entry point when implementing the first use case. Wire its dependencies in the API composition root. Keep infrastructure out of domain and application imports. Coordinate cross-module contracts through a separate reviewed change.
