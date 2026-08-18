import { AuthForm } from "@/components/auth-form";
import { signIn } from "../actions";

type SignInPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error, message } = await searchParams;

  return (
    <AuthForm
      action={signIn}
      alternateHref="/auth/sign-up"
      alternateLabel="Need an account? Create one"
      error={error}
      message={message}
      mode="sign-in"
    />
  );
}
