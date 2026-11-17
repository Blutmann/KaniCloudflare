import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAuthenticatedStaff,
  signOut,
  type AuthenticatedStaff,
  type StaffRole,
} from "@/lib/kani-auth";
import { sanitizeInternalMembershipReturnPath } from "@/lib/kani-membership-urls";
import { AdminAccess } from "./admin-access";

const RETURN_PATH_STORAGE_KEY = "kani:membership-auth-return-to";

export function formatMembershipStaffRole(role: StaffRole | string): string {
  if (role === "MANAGER") return "JEFE";
  if (role === "ADMIN") return "ADMIN";
  if (role === "BARBER") return "BARBER";
  return String(role || "").toUpperCase();
}

export function saveValidatedMembershipReturnPath(rawPath: string | null | undefined): string | null {
  const safePath = sanitizeInternalMembershipReturnPath(rawPath);
  if (!safePath) return null;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, safePath);
    } catch {
      // Ignorar si sessionStorage no está disponible
    }
  }
  return safePath;
}

export function readValidatedMembershipReturnPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeInternalMembershipReturnPath(window.sessionStorage.getItem(RETURN_PATH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearValidatedMembershipReturnPath(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RETURN_PATH_STORAGE_KEY);
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
}

export function useMembershipStaffAuth(currentPath: string) {
  const [staff, setStaff] = useState<AuthenticatedStaff | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const verifyingRef = useRef(false);

  const syncStaffSession = useCallback(async (bypassCache = false) => {
    if (verifyingRef.current) return null;
    verifyingRef.current = true;
    try {
      const resolved = await getAuthenticatedStaff(bypassCache ? { bypassCache: true } : undefined);
      setStaff(resolved);
      return resolved;
    } catch {
      setStaff(null);
      return null;
    } finally {
      verifyingRef.current = false;
      setCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void syncStaffSession(false);

    const handleStaffAuthEvent = (event: Event) => {
      if (!mounted) return;
      const custom = event as CustomEvent<{ staff?: AuthenticatedStaff | null }>;
      if (custom.detail && "staff" in custom.detail) {
        setStaff(custom.detail.staff ?? null);
        setCheckingAuth(false);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("kani:staff-auth-changed", handleStaffAuthEvent);
    }

    let unsubscribeAuth: (() => void) | undefined;
    if (typeof supabase?.auth?.onAuthStateChange === "function") {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (!mounted) return;
        if (event === "SIGNED_OUT") {
          setStaff(null);
          setCheckingAuth(false);
          return;
        }
        if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
          void syncStaffSession(true);
        }
      });
      unsubscribeAuth = () => data?.subscription?.unsubscribe();
    }

    return () => {
      mounted = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("kani:staff-auth-changed", handleStaffAuthEvent);
      }
      unsubscribeAuth?.();
    };
  }, [syncStaffSession]);

  const openLoginModal = useCallback(() => {
    saveValidatedMembershipReturnPath(currentPath);
    setAuthError(null);
    setIsLoginOpen(true);
  }, [currentPath]);

  const closeLoginModal = useCallback(() => {
    setAuthError(null);
    setIsLoginOpen(false);
  }, []);

  const handleAuthenticated = useCallback(async () => {
    setAuthError(null);
    const verified = await getAuthenticatedStaff({ bypassCache: true }).catch(() => null);
    if (!verified) {
      await signOut({ scope: "local" }).catch(() => undefined);
      setStaff(null);
      setAuthError("Esta cuenta no tiene permisos de personal interno (ADMIN, JEFE o BARBER).");
      return;
    }
    setStaff(verified);
    setIsLoginOpen(false);
    clearValidatedMembershipReturnPath();
  }, []);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut({ scope: "local" });
    } catch {
      // Asegurar limpieza local en UI aunque falle red
    } finally {
      setStaff(null);
      setAuthError(null);
      clearValidatedMembershipReturnPath();
      setSigningOut(false);
    }
  }, [signingOut]);

  return {
    staff,
    checkingAuth,
    isLoginOpen,
    authError,
    signingOut,
    openLoginModal,
    closeLoginModal,
    handleAuthenticated,
    handleSignOut,
    refreshStaff: () => syncStaffSession(true),
  };
}

export function MembershipStaffLoginModal({
  isOpen,
  onClose,
  onAuthenticated,
  authError,
  subtitle = "Iniciá sesión con tu cuenta interna para continuar sin salir de esta página.",
}: {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: () => Promise<void> | void;
  authError?: string | null;
  subtitle?: string;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Acceso de personal interno KANI"
      className="fixed inset-0 z-[60] flex items-center justify-center p-3.5 sm:p-5 bg-black/82 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl sm:rounded-3xl bg-gradient-to-b from-[#13110F] to-[#080706] border border-[#C8A96B]/40 p-5 sm:p-7 shadow-[0_28px_70px_rgba(0,0,0,0.96)] text-[#EDECEC] relative my-auto [&_label]:text-[#C8B99B] [&_label]:text-xs [&_label]:font-mono [&_label]:tracking-wider [&_label]:uppercase [&_input]:mt-1.5 [&_input]:bg-[#090807] [&_input]:border-[#2C251B] [&_input]:text-white [&_input]:placeholder-[#6E6352] [&_button[type='submit']]:bg-[#D4B475] [&_button[type='submit']]:text-[#090807] [&_button[type='submit']]:hover:bg-[#E8CC8E] [&_button[type='submit']]:font-mono [&_button[type='submit']]:tracking-[0.14em] [&_button[type='submit']]:uppercase [&_.admin-login-symbol]:mx-auto [&_.admin-login-symbol]:h-12 [&_.admin-login-symbol]:w-auto [&_.admin-login-symbol]:mb-3 [&_.admin-login-title]:text-[#D4B475] [&_.admin-login-title]:text-xs [&_.admin-login-title]:font-mono [&_.admin-login-title]:tracking-[0.24em] [&_.admin-login-title]:mb-3 [&_.admin-login-forgot-link]:text-xs [&_.admin-login-forgot-link]:text-[#9A8E78] [&_.admin-login-forgot-link:hover]:text-[#F0D9A3] [&_.admin-login-back-link]:text-xs [&_.admin-login-back-link]:text-[#9A8E78] [&_.admin-login-back-link]:inline-flex [&_.admin-login-back-link]:items-center [&_.admin-login-back-link]:gap-1.5 [&_.admin-login-status]:text-xs [&_.admin-login-status]:text-emerald-300 [&_.admin-login-recovery-copy]:text-xs [&_.admin-login-recovery-copy]:text-[#A39E93]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 p-2 rounded-full text-[#9B8A68] hover:text-white hover:bg-white/5 transition-colors cursor-pointer min-h-[38px] min-w-[38px] flex items-center justify-center"
          aria-label="Cerrar acceso de personal"
        >
          <X className="w-4 h-4" />
        </button>

        <AdminAccess
          embedded
          onAuthenticated={onAuthenticated}
          onCancel={onClose}
          subtitle={subtitle}
          externalError={authError}
        />
      </div>
    </div>
  );
}
