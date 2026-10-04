/** StonkFun's mark: two stacked, slanted tiles (redrawn as a vector). */
export function StonkMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M9.2 2.5h12.3l-4.6 8.2H4.6z" fill="#a9d6ea" />
      <path d="M7.1 13.3h12.3l-4.6 8.2H2.5z" fill="#6aa6c0" />
    </svg>
  );
}
