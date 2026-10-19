import { NavLink, Outlet } from "react-router-dom";
import { ManagementProvider, useManagement } from "../management/ManagementContext";

function ConfigShell() {
  const { notice, isBusy } = useManagement();

  return (
    <section className="module-card">
      {notice ? <p className="notice" role="status" aria-live="polite">{notice}</p> : null}
        <div className="management-progress" role={isBusy ? "status" : undefined} aria-label={isBusy ? "Procesando" : undefined} aria-hidden={!isBusy} style={{ visibility: isBusy ? "visible" : "hidden" }}>
          <div className="management-progress-bar" />
        </div>

      <div className="courses-layout">
        <aside className="courses-list-panel">
          <nav className="courses-list section-tabs" aria-label="Secciones de configuración">
            <NavLink
              to="/config/preferences"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Preferencias</span>
            </NavLink>
            <NavLink
              to="/config/comments"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Banco de comentarios</span>
            </NavLink>
            <NavLink
              to="/config/database"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Datos y copias de seguridad</span>
            </NavLink>
            <NavLink
              to="/config/student-import"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Importar alumnado</span>
            </NavLink>
            <NavLink
              to="/config/ai"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Inteligencia artificial</span>
            </NavLink>
            <NavLink
              to="/config/moodle"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Moodle</span>
            </NavLink>
            <NavLink
              to="/config/proxy"
              className={({ isActive }) => `section-tab ${isActive ? "active" : ""}`}
            >
              <span>Extensión Proxy</span>
            </NavLink>
          </nav>
        </aside>

        <section className="course-detail-panel">
          <Outlet />
        </section>
      </div>
    </section>
  );
}

export function ConfigLayout() {
  return (
    <ManagementProvider>
      <ConfigShell />
    </ManagementProvider>
  );
}
