// The version cell the two fences share.
//
// Both fences are the same mechanism — a monotonically increasing counter that a
// read captures before asking and compares after answering — and both need it
// stored outside the coordinator, because a coordinator may be constructed on
// every render and a counter living in it would reset and silently disable the
// guard it protects.
//
// They are **the same type and two independent cells**. Goal's fence orders goal
// reads against goal writes; the interaction fence orders pending-permission and
// questionnaire reads against replies. Neither bump is observable to the other,
// which is what this module makes structural rather than conventional: there is
// one cell definition to share, and nothing in it can be shared by accident
// because the cell is an object the caller owns one of per duty.

export interface WebuiVersionCell {
  current: number;
}
