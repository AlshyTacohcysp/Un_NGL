"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Squircle } from "@squircle-js/react";
import toast from "react-hot-toast";
import { Loader2, Upload, FlaskConical } from "lucide-react";

interface DemoMessage {
  id: number;
  content: string;
  hint_color: string | null;
  fingerprint: string;
}

export default function DemoLab() {
  const [palette, setPalette] = useState<string[] | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [preview, setPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [contentA, setContentA] = useState("Hello from the colour-hint lab!");
  const [contentB, setContentB] = useState("Second message, same token.");

  const handleExtract = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be 2MB or less");
      return;
    }
    setPreview(URL.createObjectURL(file));
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/demo/extract", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw json;
      setPalette(json.palette || []);
      if (json.token_fingerprint) setFingerprint(json.token_fingerprint);
    } catch (err: any) {
      toast.error(err?.error || "Failed to extract a palette");
    } finally {
      setExtracting(false);
    }
  };

  const handleSendBoth = async () => {
    if (!palette) {
      toast.error("Extract a palette from a photo first");
      return;
    }
    setSending(true);
    try {
      const results: DemoMessage[] = [];
      for (const content of [contentA, contentB]) {
        const res = await fetch("/api/demo/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const json = await res.json();
        if (!res.ok) throw json;
        results.push({
          id: Date.now() + results.length,
          content: json.content,
          hint_color: json.hint_color ?? null,
          fingerprint: json.token_fingerprint ?? fingerprint,
        });
      }
      setMessages((prev) => [...results, ...prev]);
    } catch (err: any) {
      toast.error(err?.error || "Failed to send demo message");
    } finally {
      setSending(false);
    }
  };

  const samePastille =
    messages.length >= 2 &&
    messages[0].hint_color != null &&
    messages[0].hint_color === messages[1].hint_color;

  return (
    <section className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-16">
      <header className="text-center">
        <h1 className="text-main-gradient text-4xl font-black md:text-6xl">
          Colour-hint lab
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-sm">
          No account, nothing stored. This is the exact pipeline used on real
          profiles: sharp decodes, node-vibrant extracts, an OKLab filter keeps
          visible colours, max 6. Then messages get a pastille.
        </p>
      </header>

      <Squircle cornerRadius={30} cornerSmoothing={1} asChild>
        <Card className="p-8">
          <CardHeader className="p-0">
            <CardTitle className="text-lg">
              1 · A photo becomes a palette
            </CardTitle>
          </CardHeader>
          <div className="flex flex-col items-start gap-4">
            <div className="flex items-center gap-4">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Uploaded photo preview"
                  className="size-16 rounded-xl object-cover"
                />
              )}
              <label className="inline-flex cursor-pointer items-center gap-2">
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => handleExtract(e.target.files?.[0])}
                  disabled={extracting}
                />
                <span className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-2 rounded-md px-4 py-2 text-sm font-medium shadow-xs">
                  {extracting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {extracting ? "Extracting…" : "Upload a photo"}
                </span>
              </label>
            </div>
            {palette && (
              <div className="flex flex-wrap items-center gap-2">
                {palette.map((color) => (
                  <span
                    key={color}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold"
                  >
                    <span
                      className="inline-block size-3.5 rounded-full border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                    {color}
                  </span>
                ))}
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              Palette: max 6 colours, filtered in OKLab (no greys, no
              near-blacks, no near-whites). This palette comes from the photo —
              it belongs to the <em>recipient</em>, never to the sender.
            </p>
          </div>
        </Card>
      </Squircle>

      <Squircle cornerRadius={30} cornerSmoothing={1} asChild>
        <Card className="p-8">
          <CardHeader className="p-0">
            <CardTitle className="text-lg">
              2 · Two messages, one browser
            </CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3">
            {fingerprint && (
              <p className="text-muted-foreground text-xs">
                Demo token fingerprint:{" "}
                <code className="bg-muted rounded px-1 font-mono">
                  {fingerprint}
                </code>{" "}
                — both messages below come from this same token.
              </p>
            )}
            <Textarea
              value={contentA}
              onChange={(e) => setContentA(e.target.value)}
              maxLength={200}
              disabled={sending}
              className="min-h-[60px]"
            />
            <Textarea
              value={contentB}
              onChange={(e) => setContentB(e.target.value)}
              maxLength={200}
              disabled={sending}
              className="min-h-[60px]"
            />
            <Squircle cornerRadius={10} cornerSmoothing={1} asChild>
              <Button
                onClick={handleSendBoth}
                disabled={sending || !palette}
                className="h-12 w-full text-base"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FlaskConical className="size-4" />
                )}
                Send both demo messages
              </Button>
            </Squircle>
            {!palette && (
              <p className="text-muted-foreground text-xs">
                Upload a photo first — a pastille needs a palette.
              </p>
            )}
          </div>
        </Card>
      </Squircle>

      {messages.length > 0 && (
        <Squircle cornerRadius={30} cornerSmoothing={1} asChild>
          <Card className="p-8">
            <CardHeader className="p-0">
              <CardTitle className="text-lg">The pastilles</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-3">
              {messages.map((msg) => (
                <li
                  key={msg.id}
                  className="flex items-center gap-3 rounded-xl border p-4"
                >
                  {msg.hint_color && (
                    <span
                      className="inline-block size-4 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: msg.hint_color }}
                    />
                  )}
                  <span className="flex-1 text-sm font-medium">
                    &quot;{msg.content}&quot;
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {msg.hint_color ?? "no pastille"}
                  </span>
                </li>
              ))}
            </ul>
            {samePastille && (
              <p className="text-sm font-semibold text-green-700">
                Same pastille on both: they come from the same demo token.
              </p>
            )}
          </Card>
        </Squircle>
      )}

      <Squircle cornerRadius={30} cornerSmoothing={1} asChild>
        <Card className="border-destructive/40 p-8">
          <CardHeader className="p-0">
            <CardTitle className="text-lg">What the pastille is NOT</CardTitle>
          </CardHeader>
          <ul className="text-muted-foreground list-disc space-y-2 pl-5 text-sm">
            <li>
              It is <strong className="text-foreground">not an identity</strong>
              : the colour comes from the recipient&apos;s photo, not from you.
            </li>
            <li>
              Same browser → often the same colour (one shared token per
              browser).
            </li>
            <li>
              Several strangers share one colour — it&apos;s a modulo over at
              most 6 colours.
            </li>
            <li>
              It is not a name and not a proof. UnGNL never claims to know who
              wrote a message.
            </li>
          </ul>
        </Card>
      </Squircle>

      <div className="text-center">
        <Link href="/" className="text-muted-foreground text-sm underline">
          ← Back home
        </Link>
      </div>
    </section>
  );
}
