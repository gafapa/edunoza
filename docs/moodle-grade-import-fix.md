# Moodle numeric result import and permission isolation

## Problem

`core_grading_get_definitions` can return verified grading areas together with a module-specific permission warning. The client previously classified every assignment as advanced grading whenever any warning was present. One inaccessible activity consequently prevented importing numerical grades from unrelated verified assignments.

The same fallback described an unverified method as a rubric. Conversely, an omitted area without a warning was treated as confirmed direct grading.

## Change

Grading areas are evaluated individually. A warning identifying a requested module affects that module only. A warning without a usable module identity blocks method verification for the response. Missing areas and an unavailable function remain unverified; they are never treated as confirmed direct grading or a confirmed rubric.

As of 2026-10-16, numeric assignment results can also be imported when the grading method is unknown or advanced. Each preview row carries its method classification and shows the original score, maximum, converted 0–10 result and current local grade. The teacher must choose **Importar solo resultado numérico** for each such row. The service requires a distinct `numeric-result` resolution; a generic `remote` resolution rejects the entire transaction for an unknown or advanced method. Bulk Moodle selection cannot supply that confirmation. Local values remain the default, and refreshing resets decisions.

Only the assignment's numeric result is copied. Rubric criteria, guide levels, course totals, gradebook overrides and weighting are not reproduced. Group submissions, incompatible local evaluation configurations, closed academic periods, identity checks, scale bounds, stale previews and conflict checks retain their protections. No academic records are automatically converted or changed.

## Validation

Synthetic protocol tests cover a mixed verified/restricted course, missing areas, unscoped warnings, and an unavailable grading function. Browser database tests check rejection and rollback of an unconfirmed batch, individual confirmation for unknown and advanced methods, preservation of local choices, and the 70/100 to 7/10 conversion. The UI regression connects to a synthetic service without grading definitions, proves bulk selection cannot confirm numeric-only import, and exercises individual import. Existing quick-update and conflict-preservation flows are also exercised.

Reference: [Moodle 4.5 grading API implementation](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/classes/grading_external.php). That endpoint returns grading areas and warnings per course-module ID. No live school account or student data is used in these tests.
