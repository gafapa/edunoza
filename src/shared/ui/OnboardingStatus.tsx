import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../db/database";
import { buildOnboardingChecklist, type OnboardingChecklistItem } from "../onboarding/checklist";
import { TeacherOnboarding } from "../../modules/management/TeacherOnboarding";
import { trackAnalyticsEventOnce } from "../analytics/analytics";

// Reads only what the checklist needs: small configuration tables in full, and at most
// one matching student and one matching session from the potentially large tables.
async function loadOnboardingChecklist(): Promise<OnboardingChecklistItem[]> {
  const [courses, scheduleDays, subjects, subjectCourseLinks] = await Promise.all([
    db.classGroups.toArray(), db.scheduleDays.toArray(), db.subjects.toArray(), db.subjectCourseLinks.toArray()
  ]);
  const courseIds = courses.map(course => course.id);
  const subjectIds = new Set(subjects.map(subject => subject.id));
  const [student, taskSession] = courseIds.length === 0 ? [undefined, undefined] : await Promise.all([
    db.students.where("classId").anyOf(courseIds).first(),
    db.taskSessions.where("classId").anyOf(courseIds)
      .filter(session => session.status !== "cancelled" && subjectIds.has(session.subjectId))
      .first()
  ]);
  return buildOnboardingChecklist({
    courses,
    students: student ? [student] : [],
    scheduleDays,
    subjects,
    subjectCourseLinks,
    taskSessions: taskSession ? [taskSession] : []
  });
}

export function OnboardingStatus() {
  const [items, setItems] = useState<OnboardingChecklistItem[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const subscription = liveQuery(loadOnboardingChecklist).subscribe({
      next: checklist => {
        setItems(checklist);
        setReady(true);
        if (checklist.every(item => item.complete)) {
          trackAnalyticsEventOnce("onboarding_completed");
          // Once complete the checklist is hidden, so stop re-reading tables on every write.
          // liveQuery emits asynchronously, so `subscription` is already assigned here.
          subscription.unsubscribe();
        }
      },
      error: () => setReady(false)
    });
    return () => subscription.unsubscribe();
  }, []);
  return <TeacherOnboarding items={items} isReady={ready} />;
}
