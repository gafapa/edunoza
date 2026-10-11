# Moodle grade import permission isolation

## Problem

`core_grading_get_definitions` can return verified grading areas together with a module-specific permission warning. The client previously classified every assignment as advanced grading whenever any warning was present. One inaccessible activity consequently prevented importing numerical grades from unrelated verified assignments.

The same fallback described an unverified method as a rubric. Conversely, an omitted area without a warning was treated as confirmed direct grading.

## Change

Grading areas are now evaluated individually. A warning identifying a requested module affects that module only. A warning without a usable module identity blocks verification for the response. Missing areas and an unavailable function remain unverified; they are never treated as confirmed direct grading or a confirmed rubric. The local review explains that `core_grading_get_definitions` permissions need checking for unverified tasks.

Direct grades from verified activities remain eligible for explicit review and transactional application. Advanced grading, group submissions, incompatible local evaluation configurations, and closed academic periods retain their existing protections. No academic records are automatically converted or changed.

## Validation

Synthetic protocol tests cover a mixed verified/restricted course, missing areas, unscoped warnings, and an unavailable grading function. The database browser regression checks that an eligible 70/100 grade becomes 7/10 while the grades of unverified and advanced activities remain unchanged. Existing quick-update and conflict-preservation flows are also exercised.

Reference: [Moodle 4.5 grading API implementation](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/classes/grading_external.php). That endpoint returns grading areas and warnings per course-module ID. No live school account or student data is used in these tests.
