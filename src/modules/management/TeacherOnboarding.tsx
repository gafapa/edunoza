import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { OnboardingChecklistItem } from "../../shared/onboarding/checklist";
import {
  findCurrentOnboardingStep,
  ONBOARDING_VERSION,
  readOnboardingState,
  type OnboardingState,
  writeOnboardingState
} from "../../shared/onboarding/state";
import { Modal } from "../../shared/ui/Modal";
import { getBrowserStorage } from "../../shared/storage/browserStorage";

type GuideView = "welcome" | "step";

type TeacherOnboardingProps = {
  items: OnboardingChecklistItem[];
  isReady: boolean;
};

export function TeacherOnboarding({ items, isReady }: TeacherOnboardingProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [persistedState, setPersistedState] = useState<OnboardingState | null>(() =>
    readOnboardingState(getBrowserStorage("local"))
  );
  const [guideView, setGuideView] = useState<GuideView>("welcome");
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const completedCount = items.filter((item) => item.complete).length;
  const isComplete = completedCount === items.length;
  const currentStep = useMemo(
    () => findCurrentOnboardingStep(items, persistedState?.currentStepId),
    [items, persistedState?.currentStepId]
  );
  const persist = (state: OnboardingState): void => {
    setPersistedState(state);
    writeOnboardingState(state, getBrowserStorage("local"));
  };

  useEffect(() => {
    if (!isReady || (initialized && searchParams.get("onboarding") !== "1")) {
      return;
    }

    const explicitlyRequested = searchParams.get("onboarding") === "1";
    if (explicitlyRequested) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("onboarding");
      setSearchParams(nextParams, { replace: true });
    }

    if (isComplete) {
      if (persistedState?.status !== "completed") {
        persist({ version: ONBOARDING_VERSION, status: "completed" });
      }
    } else if (explicitlyRequested) {
      setGuideView(persistedState?.status === "active" ? "step" : "welcome");
      setIsGuideOpen(true);

    }

    setInitialized(true);
  }, [
    completedCount,
    initialized,
    isComplete,
    isReady,
    persistedState,
    searchParams,
    setSearchParams
  ]);

  useEffect(() => {
    if (isReady && isComplete && persistedState?.status !== "completed") {
      persist({ version: ONBOARDING_VERSION, status: "completed" });
      setIsGuideOpen(false);
    }
  }, [isReady, isComplete, persistedState]);

  useEffect(() => {
    if (!initialized || !currentStep || persistedState?.status !== "active") {
      return;
    }
    if (persistedState.currentStepId !== currentStep.id) {
      persist({
        version: ONBOARDING_VERSION,
        status: "active",
        currentStepId: currentStep.id
      });
    }
  }, [currentStep, initialized, persistedState]);

  if (!isReady || isComplete) return null;

  const openCurrentStep = (): void => {
    setGuideView(currentStep ? "step" : "welcome");
    setIsGuideOpen(true);
  };

  const dismissGuide = (): void => {
    persist({
      version: ONBOARDING_VERSION,
      status: "dismissed",
      currentStepId: currentStep?.id
    });
    setIsGuideOpen(false);
  };

  const startGuide = (): void => {
    if (!currentStep) {
      return;
    }
    persist({
      version: ONBOARDING_VERSION,
      status: "active",
      currentStepId: currentStep.id
    });
    setGuideView("step");
  };

  const configureStep = (item: OnboardingChecklistItem): void => {
    persist({
      version: ONBOARDING_VERSION,
      status: "active",
      currentStepId: item.id
    });
    setIsGuideOpen(false);
    navigate(item.route);
  };

  return (
    <>
      <button type="button" className="onboarding-status-button" onClick={openCurrentStep}
        aria-label={`Configuración inicial: ${completedCount} de ${items.length} pasos completados`}
        title={currentStep ? `Siguiente paso: ${currentStep.label}` : "Configuración inicial"}>
        <span className="onboarding-status-label">Configuración inicial</span>
        <span className="onboarding-status-short" aria-hidden="true">Inicio</span>
        <span>{completedCount}/{items.length}</span>
      </button>

      <Modal
        open={isGuideOpen}
        title={
          guideView === "welcome"
            ? "Configura tu espacio docente"
            : currentStep?.label ?? "Configuración inicial"
        }
        subtitle={
          guideView === "welcome"
            ? "Cinco pasos hasta tu primera clase. Tú introduces los datos; Edunoza comprueba el avance."
            : `Paso ${currentStep ? items.findIndex((item) => item.id === currentStep.id) + 1 : 1} de ${items.length}`
        }
        panelClassName="teacher-onboarding-modal"
        onClose={dismissGuide}
      >
        {guideView === "welcome" ? (
          <div className="onboarding-welcome">
            <div className="onboarding-welcome-visual" aria-hidden="true">
              <span>HOY</span>
              <i />
              <b>{items.length} pasos</b>
            </div>
            <div className="onboarding-welcome-copy">
              <p>
                Vamos a conectar tu grupo, alumnado, horario, asignaturas y primera tarea para que la
                pantalla <strong>Hoy</strong> refleje tu jornada real.
              </p>
              <ol>
                {items.map((item, index) => (
                  <li key={item.id} className={item.complete ? "complete" : ""}>
                    <span aria-hidden="true">{item.complete ? "✓" : index + 1}</span>
                    <div>
                      <strong>{item.shortLabel}</strong>
                      <small>{item.description}</small>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="onboarding-privacy-note">
                Los datos se guardan en este dispositivo. La guía no crea contenido de
                ejemplo ni modifica nada sin tu confirmación.
              </p>
            </div>
            <div className="onboarding-modal-actions">
              <button type="button" className="btn secondary" onClick={dismissGuide}>
                Ahora no
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => currentStep ? configureStep(currentStep) : startGuide()}
              >
                {currentStep?.id === "course" ? "Crear el primer grupo" : "Iniciar configuración"}
              </button>
            </div>
          </div>
        ) : currentStep ? (
          <div className="onboarding-step-detail">
            <div className="onboarding-detail-index" aria-hidden="true">
              {items.findIndex((item) => item.id === currentStep.id) + 1}
            </div>
            <div>
              <span className="onboarding-eyebrow">Qué vas a conseguir</span>
              <p className="onboarding-benefit">{currentStep.benefit}</p>
              <div className="onboarding-done-rule">
                <strong>Cómo sabrás que está listo</strong>
                <span>{currentStep.completionHint}</span>
              </div>
            </div>
            <div className="onboarding-modal-actions">
              <button type="button" className="btn secondary" onClick={dismissGuide}>
                Guardar para después
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => configureStep(currentStep)}
              >
                Ir a {currentStep.shortLabel.toLocaleLowerCase("es")}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
