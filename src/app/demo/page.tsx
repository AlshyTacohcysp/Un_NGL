import type { Metadata } from "next";
import DemoLab from "./demo-lab";

export const metadata: Metadata = {
  title: "No Cap | Colour-hint lab",
  description:
    "See exactly how No Cap colour hints work. No account, nothing stored.",
};

export default function DemoPage() {
  return (
    <main className="bg-main-gradient min-h-screen w-full">
      <DemoLab />
    </main>
  );
}
