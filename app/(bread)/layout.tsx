import { OnboardingGate } from "@/components/OnboardingGate";
import { SplashGate } from "@/components/SplashGate";

export default function BreadLayout({ children }: { children: React.ReactNode }) {
  return (
    <SplashGate>
      <OnboardingGate>{children}</OnboardingGate>
    </SplashGate>
  );
}
