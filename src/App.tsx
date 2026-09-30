import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "./app/hooks";
import { hydrateAppPreferences, setSelectedClass } from "./app/store";
import { NotFoundPage } from "./modules/NotFoundPage";
import { db } from "./shared/db/database";
import { NoContextBanner } from "./shared/ui/NoContextBanner";
import { TopTabs } from "./shared/ui/TopTabs";
import { ConnectionStatus } from "./shared/ui/ConnectionStatus";
import { AppLockButton, AppLockGate } from "./shared/ui/AppLockGate";
import { PreferenceStorageNotice } from "./shared/ui/PreferenceStorageNotice";
import packageJson from "../package.json";
import { LandingPage } from "./modules/landing/LandingPage";
import { LEGAL_PATHS, LegalPage } from "./modules/legal/LegalPage";
import {
  analyticsEventForPath,
  trackAnalyticsEventOncePerSession
} from "./shared/analytics/analytics";
import { ProductFeedback } from "./shared/feedback/ProductFeedback";
import { BackupReminder, BackupStatusLink } from "./shared/ui/BackupStatus";
import { DataBackupLayout } from "./modules/config/DataBackupLayout";
import { OnboardingStatus } from "./shared/ui/OnboardingStatus";

const AttendancePage = lazy(() =>
  import("./modules/attendance/AttendancePage").then((module) => ({ default: module.AttendancePage }))
);
const AttendanceHistoryPage = lazy(() =>
  import("./modules/attendance/AttendanceHistoryPage").then((module) => ({ default: module.AttendanceHistoryPage }))
);
const AgendaPage = lazy(() =>
  import("./modules/agenda/AgendaPage").then((module) => ({ default: module.AgendaPage }))
);
const ClassroomPage = lazy(() =>
  import("./modules/classroom/ClassroomPage").then((module) => ({ default: module.ClassroomPage }))
);
const ConfigLayout = lazy(() =>
  import("./modules/config/ConfigLayout").then((module) => ({ default: module.ConfigLayout }))
);
const AiSettingsPage = lazy(() =>
  import("./modules/config/AiSettingsPage").then((module) => ({ default: module.AiSettingsPage }))
);
const MoodleSettingsPage = lazy(() =>
  import("./modules/config/MoodleSettingsPage").then((module) => ({ default: module.MoodleSettingsPage }))
);
const ProxySettingsPage = lazy(() =>
  import("./modules/config/ProxySettingsPage").then((module) => ({ default: module.ProxySettingsPage }))
);
const CommentBankPage = lazy(() =>
  import("./modules/config/CommentBankPage").then((module) => ({ default: module.CommentBankPage }))
);
const NextcloudBackupPage = lazy(() =>
  import("./modules/config/NextcloudBackupPage").then((module) => ({ default: module.NextcloudBackupPage }))
);
const GradebookPage = lazy(() =>
  import("./modules/gradebook/GradebookPage").then((module) => ({ default: module.GradebookPage }))
);
const ManagementCoursesPage = lazy(() =>
  import("./modules/management/ManagementCoursesPage").then((module) => ({ default: module.ManagementCoursesPage }))
);
const ManagementAcademicPeriodsPage = lazy(() =>
  import("./modules/management/ManagementAcademicPeriodsPage").then((module) => ({
    default: module.ManagementAcademicPeriodsPage
  }))
);
const ManagementDatabasePage = lazy(() =>
  import("./modules/management/ManagementDatabasePage").then((module) => ({ default: module.ManagementDatabasePage }))
);
const ManagementLayout = lazy(() =>
  import("./modules/management/ManagementLayout").then((module) => ({ default: module.ManagementLayout }))
);
const ManagementPreferencesPage = lazy(() =>
  import("./modules/management/ManagementPreferencesPage").then((module) => ({
    default: module.ManagementPreferencesPage
  }))
);
const ManagementSchedulePage = lazy(() =>
  import("./modules/management/ManagementSchedulePage").then((module) => ({ default: module.ManagementSchedulePage }))
);
const ManagementStudentsPage = lazy(() =>
  import("./modules/management/ManagementStudentsPage").then((module) => ({ default: module.ManagementStudentsPage }))
);
const StudentImportPage = lazy(() =>
  import("./modules/config/StudentImportPage").then((module) => ({ default: module.StudentImportPage }))
);
const ManagementTutorPage = lazy(() =>
  import("./modules/management/ManagementTutorPage").then((module) => ({ default: module.ManagementTutorPage }))
);
const ManagementSubjectsPage = lazy(() =>
  import("./modules/management/ManagementSubjectsPage").then((module) => ({ default: module.ManagementSubjectsPage }))
);
const ManagementTasksPage = lazy(() =>
  import("./modules/management/ManagementTasksPage").then((module) => ({ default: module.ManagementTasksPage }))
);
const ManagementUnitsPage = lazy(() =>
  import("./modules/management/ManagementUnitsPage").then((module) => ({ default: module.ManagementUnitsPage }))
);
const PlannerPage = lazy(() =>
  import("./modules/planner/PlannerPage").then((module) => ({ default: module.PlannerPage }))
);
const ReportsPage = lazy(() =>
  import("./modules/reports/ReportsPage").then((module) => ({ default: module.ReportsPage }))
);
const SearchPage = lazy(() =>
  import("./modules/search/SearchPage").then((module) => ({ default: module.SearchPage }))
);
const TodayPage = lazy(() =>
  import("./modules/today/TodayPage").then((module) => ({ default: module.TodayPage }))
);

function WorkspaceApp() {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const selectedClassId = useAppSelector((state) => state.app.selectedClassId);
  const studentSortBy = useAppSelector((state) => state.app.studentSortBy);
  const studentNameFormat = useAppSelector((state) => state.app.studentNameFormat);
  const weekStartsOn = useAppSelector((state) => state.app.weekStartsOn);
  const notSubmittedGradePolicy = useAppSelector((state) => state.app.notSubmittedGradePolicy);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");

  const isConfigRoute = location.pathname.startsWith("/config");
  const isManagementRoute = location.pathname.startsWith("/management");
  const isReportsRoute = location.pathname.startsWith("/reports");

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const message = event.reason instanceof Error ? event.reason.message : "Error inesperado de almacenamiento.";
      setRuntimeError(`No se pudo completar una operación: ${message}`);
    };
    const handleWindowError = (): void => {
      setRuntimeError("Se ha producido un error inesperado en la aplicación.");
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  useEffect(() => {
    let active = true;
    db.appPreferences
      .get("default")
      .then((preferences) => {
        if (!active) return;
        if (preferences) {
          dispatch(hydrateAppPreferences(preferences));
        }
        setPreferencesLoaded(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Error desconocido";
        setRuntimeError(`No se pudieron cargar las preferencias: ${message}`);
        setPreferencesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    void db.appPreferences
      .put({
        id: "default",
        studentSortBy,
        studentNameFormat,
        weekStartsOn,
        notSubmittedGradePolicy
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Error desconocido";
        setRuntimeError(`No se pudieron guardar las preferencias: ${message}`);
      });
  }, [
    notSubmittedGradePolicy,
    preferencesLoaded,
    studentNameFormat,
    studentSortBy,
    weekStartsOn
  ]);

  useEffect(() => {
    if (isConfigRoute || isManagementRoute) return;

    let active = true;
    const load = async () => {
      const groups = await db.classGroups.orderBy("name").toArray();
      if (!active) return;
      const selectedExists = groups.some((group) => group.id === selectedClassId);
      if (!selectedExists && groups.length > 0) dispatch(setSelectedClass(groups[0].id));
      if (groups.length === 0) dispatch(setSelectedClass(null));
    };

    void load().catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : "Error desconocido";
      setRuntimeError(`No se pudo cargar el contexto académico: ${message}`);
    });
    return () => {
      active = false;
    };
  }, [dispatch, isConfigRoute, isManagementRoute, selectedClassId]);

  return (
    <AppLockGate>
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido principal
      </a>
      <div className="acet-beam-bg" aria-hidden="true" />

      <TopTabs />

      <div id="global-notification-region" className="global-notification-region">
        <PreferenceStorageNotice />
        <BackupReminder />
      </div>

      {runtimeError ? (
        <div className="runtime-error" role="alert">
          <span>{runtimeError}</span>
          <button type="button" className="btn secondary" onClick={() => setRuntimeError("")}>
            Cerrar
          </button>
        </div>
      ) : null}

      {!isConfigRoute && !isManagementRoute && !isReportsRoute && (
        <NoContextBanner
          noClass={!selectedClassId}
          noSubject={false}
        />
      )}

      <main className="main-panel" id="main-content">
        <Suspense
          fallback={
            <div className="route-loading" role="status" aria-live="polite">
              Cargando sección…
            </div>
          }
        >
          <Routes>
          <Route path="/" element={<Navigate replace to="/today" />} />

          <Route path="/management" element={<ManagementLayout />}>
            <Route index element={<Navigate replace to="/management/courses" />} />
            <Route path="courses" element={<ManagementCoursesPage />} />
            <Route path="periods" element={<ManagementAcademicPeriodsPage />} />
            <Route path="students" element={<ManagementStudentsPage />} />
            <Route path="tutor" element={<ManagementTutorPage />} />
            <Route path="subjects" element={<ManagementSubjectsPage />} />
            <Route path="tasks" element={<ManagementTasksPage />} />
            <Route path="units" element={<ManagementUnitsPage />} />
            <Route path="schedule" element={<ManagementSchedulePage />} />
          </Route>

          <Route path="/config" element={<ConfigLayout />}>
            <Route index element={<Navigate replace to="/config/preferences" />} />
            <Route path="preferences" element={<ManagementPreferencesPage />} />
            <Route path="comments" element={<CommentBankPage />} />
            <Route path="database" element={<DataBackupLayout />}>
              <Route index element={<ManagementDatabasePage />} />
              <Route path="nextcloud" element={<NextcloudBackupPage />} />
            </Route>
            <Route path="nextcloud" element={<Navigate replace to="/config/database/nextcloud" />} />
            <Route path="student-import" element={<StudentImportPage />} />
            <Route path="ai" element={<AiSettingsPage />} />
            <Route path="moodle" element={<MoodleSettingsPage />} />
            <Route path="proxy" element={<ProxySettingsPage />} />
          </Route>

          <Route path="/today" element={<TodayPage />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/classroom" element={<ClassroomPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/gradebook" element={<GradebookPage />} />
          <Route path="/journal" element={<Navigate replace to="/journal/attendance" />} />
          <Route path="/journal/attendance" element={<AttendanceHistoryPage />} />
          <Route path="/journal/work" element={<AttendancePage />} />
          <Route path="/planner" element={<PlannerPage />} />
          <Route path="/reports" element={<ReportsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="status-bar" aria-label="Estado de la aplicación">
        <ConnectionStatus />
        <OnboardingStatus />
        <BackupStatusLink />
        <ProductFeedback placement="status" />
        <AppLockButton />
        <NavLink className="status-bar-legal-link" to="/legal" aria-label="Información legal y privacidad">Legal</NavLink>
        <span className="status-bar-brand">Edunoza</span>
        <span className="status-bar-version">v{packageJson.version}</span>
      </footer>
    </div>
    </AppLockGate>
  );
}

function App() {
  const location = useLocation();

  useEffect(() => {
    trackAnalyticsEventOncePerSession("app_open");
  }, []);

  useEffect(() => {
    const event = analyticsEventForPath(location.pathname);
    if (event) trackAnalyticsEventOncePerSession(event);
  }, [location.pathname]);

  if (location.pathname === "/") {
    return <LandingPage />;
  }

  if (LEGAL_PATHS.has(location.pathname)) {
    return <LegalPage />;
  }

  return <WorkspaceApp />;
}

export default App;
