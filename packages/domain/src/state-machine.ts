/**
 * Generic, data-driven state machine.
 *
 * The spec defines 18 asset statuses, 16 request statuses and 16 invoice
 * verification statuses. Expressing those as branching `if` chains in service
 * code is unmaintainable and untestable; declaring them as transition maps means
 * the legality of every move is one lookup, and the exhaustiveness tests below
 * can walk the whole graph.
 */

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${machine} transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly initial: S;
  /** Every state maps to the exhaustive list of states reachable from it. */
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  /** States from which nothing may follow. */
  readonly terminal: readonly S[];
}

export function canTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  if (from === to) return true;
  return (machine.transitions[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): void {
  if (!canTransition(machine, from, to)) {
    throw new IllegalTransitionError(machine.name, from, to);
  }
}

export function nextStates<S extends string>(machine: StateMachine<S>, from: S): readonly S[] {
  return machine.transitions[from] ?? [];
}

export function isTerminal<S extends string>(machine: StateMachine<S>, state: S): boolean {
  return machine.terminal.includes(state);
}
