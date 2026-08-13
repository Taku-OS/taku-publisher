# Subagent Pilot Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the five low-context subagent pilot conversions into converter improvements, especially around framework detection, safety review, conversion-mode clarity, and repeatable experience capture.

**Architecture:** Keep the converter as a local CLI package. Improve static analysis with lightweight content scanning, generate stronger handoff files into every conversion workspace, and document pilot results so future low-context agents can follow a narrower path.

**Tech Stack:** TypeScript, Node built-in test runner, Commander CLI, generated Next.js Taku SubApp workspaces.

---

## Tasks

- [x] Add analyzer tests for nested Streamlit and FastAPI + Next.js repos.
- [x] Implement content-signal scanning for Python dependency/import files and risk hints.
- [x] Generate `skills/safety-review.md` in every workspace.
- [x] Generate `SUBAGENT_EXPERIENCE.md` in every workspace.
- [x] Update root and generated skills with conversion modes, safety defaults, and action/route smoke-test requirements.
- [x] Write a consolidated low-context pilot experience report.
- [x] Run final `pnpm test`, `pnpm build`, CLI smoke commands, and five-workspace validation before reporting completion.
