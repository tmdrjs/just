import type { AgendaFilters } from "./store";
import type { Agenda } from "./types";

export function matchesFilters(a: Agenda, f: AgendaFilters) {
  return f.status === "all" || a.status === f.status;
}

export function isFiltering(f: AgendaFilters) {
  return f.status !== "all";
}
