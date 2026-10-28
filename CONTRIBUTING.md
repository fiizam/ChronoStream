# Contributing to ChronoStream

Thank you for your interest in contributing to **ChronoStream**!

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- Redis 7+ (local instance or via `docker compose up -d redis`)

## Local Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/fiizam/ChronoStream.git
   cd ChronoStream
   ```
2. Install dependencies:
   ```bash
   bun install
   ```
3. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```
4. Start the development server with hot reload:
   ```bash
   bun run dev
   ```

## Running Tests & Type Checks

Before submitting a Pull Request, ensure all tests and strict TypeScript checks pass:

```bash
# Run strict TypeScript verification
bun x tsc --noEmit

# Run unit, integration, and E2E test suites
bun test
```

## Pull Request Guidelines

- Create a descriptive feature or bugfix branch from `main` (e.g., `feat/my-feature` or `fix/issue-description`).
- Keep commits atomic and use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `build:`).
- Add or update unit/integration tests in `test/` for any new routes, broker behaviors, or middleware.
- Preserve zero-memory-leak guarantees in `ChannelBroker` when modifying stream lifecycle logic.
