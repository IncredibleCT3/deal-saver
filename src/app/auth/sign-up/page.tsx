import { AuthForm } from "@/components/auth-form";
import { signUp } from "../actions";

type SignUpPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { error } = await searchParams;

  return (
    <AuthForm
      action={signUp}
      alternateHref="/auth/sign-in"
      alternateLabel="Already have an account? Sign in"
      error={error}
      mode="sign-up"
    />
  );
}
