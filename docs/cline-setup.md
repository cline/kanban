# Cline Setup

If you want to use Cline in Kanban, the most important thing to know is that Cline is built into Kanban's native runtime path. You are not simply launching a separate terminal command and hoping Kanban can discover it. Instead, Kanban gives you a Cline-specific setup flow in onboarding and in Settings.

That makes Cline the easiest place for many new users to start.

## When Cline is the right choice

Choose Cline when you want Kanban to guide most of the setup for you. It is especially useful if you are new to Kanban, do not already have Claude Code or Codex configured in your shell, or want the project-scoped sidebar chat that Kanban exposes for Cline.

If you already have a mature Claude Code or Codex workflow and want Kanban mostly for orchestration and review, one of those tools may still be the better fit. But if you want the smoothest built-in setup path, Cline is the natural default.

## Open the Cline setup controls

You can configure Cline in two places:

- the **Get started** onboarding dialog on first launch
- **Settings**, under **Agent runtime**, after choosing Cline

Both paths lead to the same core setup: choose a provider, choose a model, then authenticate.

## Step 1: Choose a provider

The provider is the service Cline will talk to for model access. Kanban loads the available providers for you and lets you choose one from a searchable list.

If you already know which provider account you plan to use, choose that one. If you are unsure, the right answer is usually the provider you already trust and already pay for, or the one that matches your team's existing setup.

The important point is not to overthink this step. You can change it later in Settings.

## Step 2: Choose a model

After you choose a provider, Kanban loads the models available through that provider. Pick the model you want Cline to use for task work.

If you are just getting started, choose a general-purpose model you already trust rather than trying to optimize immediately for every edge case. Kanban's value comes from the workflow around the model as much as from the model itself.

## Step 3: Authenticate

Kanban supports two broad authentication styles for Cline:

### OAuth

If the provider supports OAuth, you can sign in from the UI. Kanban will open the provider sign-in flow and return you to the app when it succeeds. Once this is complete, the Cline setup area should show that you are signed in.

### API key

If you are using a provider that expects a direct API key or an OpenAI-compatible endpoint, enter the API key in the setup area. Some providers may also require a base URL.

If you are not sure whether to use OAuth or an API key, follow the option that matches the provider you selected. Kanban presents the appropriate controls based on that provider.

## How to tell when setup is complete

Cline is ready when all of the following are true:

- a provider is selected
- a model is selected
- authentication is complete

In practical terms, that means either the UI shows that you are signed in, or your API key configuration has been saved successfully.

Once Cline is ready, you should be able to start a task without Kanban treating Cline as unconfigured.

## Optional MCP settings

In Settings, Kanban also exposes Cline MCP server configuration. This is an advanced capability for connecting external tools and services into the Cline runtime.

Most new users do not need to touch MCP settings on day one. If you do not already know that you need an MCP server, you can safely ignore that section while you are learning the core Kanban workflow.

If you do use MCP servers later, Kanban lets you configure them directly in the Cline setup surface, including OAuth for compatible servers.

## Common Cline setup problems

If Cline is selected but tasks still will not start, the usual cause is that the provider setup is incomplete rather than that Kanban itself is broken.

Check these first:

- no provider selected yet
- provider selected but no model selected
- OAuth flow started but not completed
- API key not entered or not saved

If you correct those and save your settings, Kanban should treat Cline as ready.

If the app still feels stuck, the [troubleshooting guide](./troubleshooting.md) is the right next step.