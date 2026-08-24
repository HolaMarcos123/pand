import Image from "next/image";

/**
 * El onboarding vive fuera del route group `(dashboard)` a proposito: ese layout
 * redirige a `/onboarding` cuando la organizacion no termino el wizard, asi que si
 * el wizard colgara de ahi se redirigiria a si mismo en loop.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-pand-bg px-6 py-12">
      <Image
        src="/brand/logo.svg"
        alt="Pand"
        width={1400}
        height={420}
        priority
        className="mb-10 h-8 w-auto"
      />
      {children}
    </div>
  );
}
