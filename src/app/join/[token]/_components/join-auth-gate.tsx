"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthForm } from "@/app/(auth)/_components/auth-form";

/**
 * `intro` is composed by the server page, which is the only place the
 * crèche's name is known (from kg_staff_invite_preview) — the gate itself
 * stays a dumb pair of forms.
 */
export function JoinAuthGate({ token, intro }: { token: string; intro: string }) {
  const t = useTranslations("auth");
  const next = `/join/${token}`;

  return (
    <div>
      <p className="mb-5 text-sm text-muted-foreground text-pretty">{intro}</p>
      <Tabs defaultValue="signup">
        <TabsList className="w-full">
          <TabsTrigger value="signup" className="flex-1 data-active:text-primary">
            {t("join.signupTab")}
          </TabsTrigger>
          <TabsTrigger value="login" className="flex-1 data-active:text-primary">
            {t("join.loginTab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="signup" className="pt-6">
          <AuthForm mode="signup" next={next} idPrefix="join-signup" />
        </TabsContent>
        <TabsContent value="login" className="pt-6">
          <AuthForm mode="login" next={next} idPrefix="join-login" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
