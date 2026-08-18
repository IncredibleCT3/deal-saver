# AGENTS.md

## Project Scope

- `MVP.md` is the authoritative implementation scope for the current build.
- `REQUIREMENTS.md` describes the long-term product vision only.
- Never implement a feature solely because it appears in `REQUIREMENTS.md`.
- Do not silently expand the requested scope.
- Build one MVP phase at a time.
- Do not begin the next phase unless explicitly instructed.

## Development Priorities

This project is being built by a solo developer with a very small budget.

Always prioritize:

1. Simplicity
2. Low recurring cost
3. Maintainability
4. Easy debugging
5. Fast iteration
6. Free or low-cost infrastructure where practical

Avoid unnecessary complexity.

Do not introduce microservices, Kubernetes, Kafka, Redis, message brokers, distributed systems, or similar infrastructure unless explicitly requested and clearly justified.

## Preferred Stack

Prefer the following unless there is a documented reason to do otherwise:

- Next.js
- TypeScript
- Tailwind CSS
- Supabase
- PostgreSQL
- Supabase Auth
- Vercel or similarly simple hosting

Use Next.js server-side functionality before introducing a separate backend service.

## Architecture Rules

- Keep retailer-specific logic isolated behind retailer adapters or integrations.
- Do not put retailer parsing or scraping logic directly inside UI components.
- Keep external service integrations modular.
- Avoid premature abstractions.
- Avoid creating generic frameworks for problems that currently have only one implementation.
- Reuse shared logic where it clearly reduces duplication.
- Prefer clear, boring code over clever code.
- Keep the architecture appropriate for the current MVP scale.

## Retailer Integrations

Retailer integrations should live in a dedicated area such as:

`src/lib/retailers/`

Each retailer adapter should expose a consistent interface where practical.

For example:

- `supportsUrl(url)`
- `getProduct(url)`

Normalized product data should use a shared type/interface.

Do not attempt universal retailer scraping unless explicitly requested.

## Database Rules

- Use Supabase/PostgreSQL for persistent application data.
- Database changes must be reproducible through migration or schema files committed to the repository.
- Use Row Level Security where appropriate.
- Users must not be able to access another user's private watchlist or alert data.
- Avoid denormalizing data unless there is a clear reason.
- Do not create unnecessary tables or fields for future features that are not part of the current MVP phase.

## Security

- Never commit secrets, API keys, tokens, passwords, service-role keys, or credentials.
- Use environment variables for secrets.
- Maintain `.env.example` with variable names and safe placeholder values only.
- Never expose server-only secrets to client-side code.
- Validate external URLs server-side.
- Validate user-controlled numeric inputs such as prices.
- Do not trust client-provided user IDs for authorization.
- Use authenticated server context and database security policies where appropriate.
- Ask before adding a significant paid service or dependency.

## Dependencies

- Install only dependencies that are necessary for the current task.
- Prefer mature, well-maintained libraries.
- Do not add a dependency when a small amount of straightforward code can reasonably solve the problem.
- Avoid duplicate libraries that solve the same problem.
- Explain any significant new production dependency in the final task summary.

## UI

- Keep the interface simple, clean, responsive, and functional.
- Prioritize usability over visual complexity.
- Do not spend significant implementation time on animations or elaborate design systems during the MVP unless explicitly requested.
- Reuse components when it improves clarity without over-abstracting.

## Testing and Validation

After meaningful code changes, run the relevant available checks.

Prefer to run:

1. Lint
2. TypeScript/type checking
3. Automated tests, if present
4. Production build

Fix failures caused by your changes before considering the task complete.

Do not claim something works unless it was either tested or clearly identified as unverified.

For changes involving user flows, provide concise manual testing steps when useful.

## Git and Files

- Do not modify unrelated files without a reason.
- Do not delete user work unless explicitly requested or clearly necessary.
- Keep generated files and local secrets out of Git.
- Maintain an appropriate `.gitignore`.
- Keep commits and changes logically scoped when asked to commit.
- Do not rewrite Git history unless explicitly requested.

## Documentation

- Keep `README.md` setup instructions accurate as the project evolves.
- Document required environment variables.
- Document external setup steps that cannot be automated.
- Keep documentation concise and current.
- Do not duplicate large sections of `MVP.md` or `REQUIREMENTS.md` unnecessarily.

## Cost Discipline

Before introducing infrastructure or services, prefer options that can operate on free tiers or at very low cost during MVP development.

Do not introduce:

- High-frequency polling without a demonstrated need
- Always-on servers when scheduled/serverless execution is sufficient
- Expensive AI calls for deterministic tasks
- Paid queues or caching services when the MVP does not need them
- Large-scale crawling infrastructure before product demand is proven

If a proposed implementation has meaningful recurring cost, surface that before implementing it when possible.

## Scope Discipline

When implementing a specific phase from `MVP.md`:

- Implement only that phase and its necessary prerequisites.
- Do not implement later-phase features "while you're here."
- Do not add speculative infrastructure for future phases.
- If a later feature affects a current architectural decision, keep the current design extensible but simple.

Examples:

- Do not implement retailer scraping during the Watchlist phase.
- Do not implement alerts during the Price History phase unless explicitly requested.
- Do not implement cross-store matching during the single-retailer MVP.
- Do not implement premium subscriptions during the MVP.

## Completion Requirements

At the end of every implementation task, provide a concise summary containing:

1. What changed
2. Important files changed
3. Tests/checks run
4. Anything the developer must configure manually
5. Known limitations or follow-up items

If something could not be completed, say exactly what remains and why.

## Decision Rule

When multiple implementation options are reasonable, choose the option that is:

- Easier for one developer to understand
- Cheaper to run
- Easier to replace later
- Less likely to create maintenance burden
- Sufficient for the current MVP rather than hypothetical future scale
