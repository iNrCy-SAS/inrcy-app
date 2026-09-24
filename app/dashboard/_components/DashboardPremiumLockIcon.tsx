type DashboardPremiumLockIconProps = {
  className?: string;
};

/**
 * Repère visuel commun des fonctions visibles mais réservées à Premium.
 * Il reste décoratif : le libellé adjacent porte toujours l'information
 * accessible (« Premium »).
 */
export function DashboardPremiumLockIcon({ className }: DashboardPremiumLockIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
