import { Container } from "../components/ui/Container";
import { Button } from "../components/ui/Button";
import { Seo } from "../lib/seo";

export default function NotFound() {
  return (
    <>
      <Seo title="Page not found" path="/404" />
      <div className="h-20 bg-navy-950" aria-hidden="true" />
      <section className="flex min-h-[80svh] items-center bg-cream-100">
        <Container className="py-24 text-center">
          <p className="font-display text-8xl font-medium text-coral-500 sm:text-9xl">404</p>
          <h1 className="font-display mt-4 text-4xl font-medium text-navy-900 sm:text-5xl">
            This page is taking a rest day.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-ink-600">
            The page you're looking for doesn't exist or has been moved. Let's get you back
            home.
          </p>
          <Button to="/" variant="primary" size="lg" withArrow className="mt-10">
            Back to AFhomes
          </Button>
        </Container>
      </section>
    </>
  );
}