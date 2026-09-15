import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/30 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-semibold tracking-tight">
            Welcome to Taku App
          </CardTitle>
          <CardDescription className="text-base">
            A blank template – Feel free to edit it!
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
