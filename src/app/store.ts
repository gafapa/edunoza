import {
  configureStore,
  createListenerMiddleware,
  createSlice,
  type PayloadAction
} from "@reduxjs/toolkit";
import { getBrowserStorage } from "../shared/storage/browserStorage";

export const PREFERENCE_STORAGE_EVENT = "edunoza:preference-storage";
let preferenceStorageUnavailable = false;
export function hasPreferenceStorageError(): boolean { return preferenceStorageUnavailable; }
function reportPreferenceStorageError(): void {
  preferenceStorageUnavailable = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFERENCE_STORAGE_EVENT));
}
function readPreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = getBrowserStorage("local");
    if (!storage) { reportPreferenceStorageError(); return null; }
    return storage.getItem(key);
  } catch { reportPreferenceStorageError(); return null; }
}

export type StudentSortBy = "lastName" | "firstName";
export type StudentNameFormat = "firstLast" | "lastFirst";
export type WeekStartsOn = "monday" | "sunday";
export type NotSubmittedGradePolicy = "exclude" | "zero";

export type AppPreferences = {
  studentSortBy: StudentSortBy;
  studentNameFormat: StudentNameFormat;
  weekStartsOn: WeekStartsOn;
  notSubmittedGradePolicy: NotSubmittedGradePolicy;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  studentSortBy: "lastName",
  studentNameFormat: "firstLast",
  weekStartsOn: "monday",
  notSubmittedGradePolicy: "exclude"
};

type AppState = {
  selectedClassId: string | null;
  selectedSubjectId: string;
  studentSortBy: StudentSortBy;
  studentNameFormat: StudentNameFormat;
  weekStartsOn: WeekStartsOn;
  notSubmittedGradePolicy: NotSubmittedGradePolicy;
};

function readStudentSortBy(): StudentSortBy {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES.studentSortBy;
  const v = readPreference("student_sort_by");
  return v === "firstName" ? "firstName" : DEFAULT_APP_PREFERENCES.studentSortBy;
}

function readStudentNameFormat(): StudentNameFormat {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES.studentNameFormat;
  const v = readPreference("student_name_format");
  return v === "lastFirst" ? "lastFirst" : DEFAULT_APP_PREFERENCES.studentNameFormat;
}

function readWeekStartsOn(): WeekStartsOn {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES.weekStartsOn;
  const v = readPreference("week_starts_on");
  return v === "sunday" ? "sunday" : DEFAULT_APP_PREFERENCES.weekStartsOn;
}

function readNotSubmittedGradePolicy(): NotSubmittedGradePolicy {
  if (typeof window === "undefined") return DEFAULT_APP_PREFERENCES.notSubmittedGradePolicy;
  return readPreference("not_submitted_grade_policy") === "zero" ? "zero" : "exclude";
}

function writePreferencesToLocalStorage(preferences: AppPreferences): void {
  if (typeof window === "undefined") return;
  try {
    const storage = getBrowserStorage("local");
    if (!storage) { reportPreferenceStorageError(); return; }
    storage.setItem("student_sort_by", preferences.studentSortBy);
    storage.setItem("student_name_format", preferences.studentNameFormat);
    storage.setItem("week_starts_on", preferences.weekStartsOn);
    storage.setItem("not_submitted_grade_policy", preferences.notSubmittedGradePolicy);
    preferenceStorageUnavailable = false;
    window.dispatchEvent(new Event(PREFERENCE_STORAGE_EVENT));
  } catch { reportPreferenceStorageError(); }
}

const initialState: AppState = {
  selectedClassId: null,
  selectedSubjectId: "",
  studentSortBy: readStudentSortBy(),
  studentNameFormat: readStudentNameFormat(),
  weekStartsOn: readWeekStartsOn(),
  notSubmittedGradePolicy: readNotSubmittedGradePolicy()
};

const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setSelectedClass(state, action: PayloadAction<string | null>) {
      // Changing the course always clears the active subject.
      // TopTabs selects the first available subject for the new course.
      if (state.selectedClassId !== action.payload) {
        state.selectedSubjectId = "";
      }
      state.selectedClassId = action.payload;
    },
    setSelectedSubject(state, action: PayloadAction<string>) {
      state.selectedSubjectId = action.payload;
    },
    setStudentSortBy(state, action: PayloadAction<StudentSortBy>) {
      state.studentSortBy = action.payload;
    },
    setStudentNameFormat(state, action: PayloadAction<StudentNameFormat>) {
      state.studentNameFormat = action.payload;
    },
    setWeekStartsOn(state, action: PayloadAction<WeekStartsOn>) {
      state.weekStartsOn = action.payload;
    },
    setNotSubmittedGradePolicy(state, action: PayloadAction<NotSubmittedGradePolicy>) {
      state.notSubmittedGradePolicy = action.payload;
    },
    hydrateAppPreferences(state, action: PayloadAction<Partial<AppPreferences>>) {
      state.studentSortBy =
        action.payload.studentSortBy === "firstName" ? "firstName" : DEFAULT_APP_PREFERENCES.studentSortBy;
      state.studentNameFormat =
        action.payload.studentNameFormat === "lastFirst"
          ? "lastFirst"
          : DEFAULT_APP_PREFERENCES.studentNameFormat;
      state.weekStartsOn =
        action.payload.weekStartsOn === "sunday" ? "sunday" : DEFAULT_APP_PREFERENCES.weekStartsOn;
      state.notSubmittedGradePolicy =
        action.payload.notSubmittedGradePolicy === "zero"
          ? "zero"
          : DEFAULT_APP_PREFERENCES.notSubmittedGradePolicy;
    }
  }
});

const preferencesListener = createListenerMiddleware<{ app: AppState }>();
preferencesListener.startListening({
  predicate: (_action, currentState, previousState) => {
    const current = currentState.app;
    const previous = previousState.app;
    return (
      current.studentSortBy !== previous.studentSortBy ||
      current.studentNameFormat !== previous.studentNameFormat ||
      current.weekStartsOn !== previous.weekStartsOn ||
      current.notSubmittedGradePolicy !== previous.notSubmittedGradePolicy
    );
  },
  effect: (_action, listenerApi) => {
    const app = listenerApi.getState().app;
    writePreferencesToLocalStorage({
      studentSortBy: app.studentSortBy,
      studentNameFormat: app.studentNameFormat,
      weekStartsOn: app.weekStartsOn,
      notSubmittedGradePolicy: app.notSubmittedGradePolicy
    });
  }
});

export const {
  setSelectedClass,
  setSelectedSubject,
  setStudentSortBy,
  setStudentNameFormat,
  setWeekStartsOn,
  setNotSubmittedGradePolicy,
  hydrateAppPreferences
} = appSlice.actions;

export const store = configureStore({
  reducer: {
    app: appSlice.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(preferencesListener.middleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
