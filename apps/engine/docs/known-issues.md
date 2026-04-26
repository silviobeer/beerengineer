# Known Issues

- low maintainability: Shared helper logic appears duplicated in multiple modules.
- setup-wave planning metadata (`screenIds`, `sharedFiles`, `tasks.contract`) depends on planners emitting structured fields consistently; weak planner output will reduce the benefit of the new reliability path.
