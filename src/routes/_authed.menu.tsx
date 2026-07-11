import { useEffect, useId, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { listMenu, createMenuItem, updateMenuItem, deleteMenuItem } from "@/server/menu";
import { formatGBP } from "@/server/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/menu")({
  loader: async () => await listMenu(),
  component: MenuPage,
});

type MenuData = Awaited<ReturnType<typeof listMenu>>;
type Item = MenuData["items"][number];

// ── the dish form (shared by "Add dish" and the edit view) ─────────────────

type FormState = {
  name: string;
  category: string;
  price: string;
  description: string;
  videoUrl: string;
  coverUrl: string;
  isBestseller: boolean;
  published: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  category: "",
  price: "",
  description: "",
  videoUrl: "",
  coverUrl: "",
  isBestseller: false,
  published: true,
};

function itemToForm(item: Item): FormState {
  return {
    name: item.name,
    category: item.category ?? "",
    price: item.price ?? "",
    description: item.description ?? "",
    videoUrl: item.videoUrl ?? "",
    coverUrl: item.coverUrl ?? "",
    isBestseller: item.isBestseller,
    published: item.published,
  };
}

/** Parses the price text field. Empty → no price. Invalid → null (caller rejects). */
function parsePrice(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function MenuItemFormFields({
  form,
  setForm,
  categories,
}: {
  form: FormState;
  setForm: (updater: (f: FormState) => FormState) => void;
  categories: string[];
}) {
  const categoryListId = useId();

  return (
    <div className="flex flex-col gap-4">
      <Field label="Dish name">
        <Input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Dragon Chicken"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Input
            list={categoryListId}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Chicken"
          />
          <datalist id={categoryListId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Price (GBP)">
          <Input
            inputMode="decimal"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            placeholder="8.50"
          />
        </Field>
      </div>
      <Field label="Recipe notes / description">
        <Textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Plate it the same at every site — crispy batter, glossy dragon sauce, spring onion to finish."
        />
      </Field>
      <Field label="Training video link" hint="Paste a YouTube / Vimeo / direct video link">
        <Input
          value={form.videoUrl}
          onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))}
          placeholder="https://youtube.com/watch?v=…"
        />
      </Field>
      <Field label="Cover image link" hint="Paste a direct image link — shown on the dish card">
        <Input
          value={form.coverUrl}
          onChange={(e) => setForm((f) => ({ ...f, coverUrl: e.target.value }))}
          placeholder="https://…/dragon-chicken.jpg"
        />
      </Field>
      <div className="flex items-center justify-between border-2 border-foreground/15 px-3 py-2.5">
        <Label>Bestseller</Label>
        <Switch
          checked={form.isBestseller}
          onCheckedChange={(v) => setForm((f) => ({ ...f, isBestseller: v }))}
        />
      </div>
      <div className="flex items-center justify-between border-2 border-foreground/15 px-3 py-2.5">
        <Label>Published — visible to crew</Label>
        <Switch
          checked={form.published}
          onCheckedChange={(v) => setForm((f) => ({ ...f, published: v }))}
        />
      </div>
    </div>
  );
}

// ── video embed helper ──────────────────────────────────────────────────────

type EmbedInfo = { kind: "iframe" | "video" | "link"; src: string };

/** Converts a pasted YouTube/Vimeo/direct video link into something we can render. */
function toEmbedUrl(url: string): EmbedInfo {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtube.com") {
      const watchId = u.searchParams.get("v");
      if (watchId) return { kind: "iframe", src: `https://www.youtube.com/embed/${watchId}` };
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return { kind: "iframe", src: `https://www.youtube.com/embed/${shorts[1]}` };
      const embed = u.pathname.match(/^\/embed\/([^/]+)/);
      if (embed) return { kind: "iframe", src: url };
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
    }
    if (host === "vimeo.com") {
      const id = u.pathname.match(/^\/(\d+)/);
      if (id) return { kind: "iframe", src: `https://player.vimeo.com/video/${id[1]}` };
    }
    if (host === "player.vimeo.com") {
      return { kind: "iframe", src: url };
    }
    if (/\.(mp4|webm|mov)$/i.test(u.pathname)) {
      return { kind: "video", src: url };
    }
  } catch {
    // Not a parseable absolute URL — fall through to a plain link.
  }
  return { kind: "link", src: url };
}

function VideoEmbed({ embed }: { embed: EmbedInfo }) {
  if (embed.kind === "iframe") {
    return (
      <div className="aspect-video w-full overflow-hidden border-2 border-foreground bg-black">
        <iframe
          src={embed.src}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Dish training video"
        />
      </div>
    );
  }
  if (embed.kind === "video") {
    return (
      <video
        controls
        className="aspect-video w-full border-2 border-foreground bg-black"
        src={embed.src}
      />
    );
  }
  return (
    <a
      href={embed.src}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-center gap-2 border-2 border-dashed border-foreground/30 py-6 font-mono text-xs font-bold uppercase tracking-widest text-pop transition-colors hover:border-pop"
    >
      Watch the video ↗
    </a>
  );
}

// ── fallback cover (no image yet) ───────────────────────────────────────────

function FallbackCover({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted">
      <span className="font-display text-4xl uppercase text-foreground/60">{initials}</span>
      <span className="font-chinese text-2xl text-gold">菜</span>
    </div>
  );
}

// ── category filter chips ───────────────────────────────────────────────────

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap border-2 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest transition-all",
        active
          ? "border-foreground bg-pop text-ink shadow-neo-sm"
          : "border-foreground/25 text-muted-foreground hover:border-foreground/50 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ── add dish ─────────────────────────────────────────────────────────────

function AddDishDialog({ categories }: { categories: string[] }) {
  const router = useRouter();
  const createFn = useServerFn(createMenuItem);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  async function submit() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Dish name is required");
      return;
    }
    const price = parsePrice(form.price);
    if (price === undefined) {
      toast.error("Price must be a number");
      return;
    }
    setBusy(true);
    try {
      await createFn({
        data: {
          name,
          category: form.category.trim() || null,
          price,
          description: form.description.trim() || null,
          videoUrl: form.videoUrl.trim() || null,
          coverUrl: form.coverUrl.trim() || null,
          isBestseller: form.isBestseller,
          published: form.published,
        },
      });
      setOpen(false);
      setForm(EMPTY_FORM);
      toast.success(`${name} added to the menu`);
      router.invalidate();
    } catch {
      toast.error("Couldn't add the dish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setForm(EMPTY_FORM);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add dish
        </Button>
      </DialogTrigger>
      <DialogContent title="Add dish">
        <div className="flex flex-col gap-4">
          <MenuItemFormFields form={form} setForm={setForm} categories={categories} />
          <Button disabled={busy} onClick={submit}>
            {busy ? "Adding…" : "Add to the menu"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── dish card + detail/edit dialog ──────────────────────────────────────────

function DishCard({
  item,
  canManage,
  canSeeDrafts,
  categories,
}: {
  item: Item;
  canManage: boolean;
  canSeeDrafts: boolean;
  categories: string[];
}) {
  const router = useRouter();
  const updateFn = useServerFn(updateMenuItem);
  const deleteFn = useServerFn(deleteMenuItem);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(() => itemToForm(item));

  useEffect(() => {
    if (open) setForm(itemToForm(item));
  }, [open, item]);

  const embed = item.videoUrl ? toEmbedUrl(item.videoUrl) : null;

  async function saveEdit() {
    const name = form.name.trim();
    if (!name) {
      toast.error("Dish name is required");
      return;
    }
    const price = parsePrice(form.price);
    if (price === undefined) {
      toast.error("Price must be a number");
      return;
    }
    setBusy(true);
    try {
      await updateFn({
        data: {
          id: item.id,
          patch: {
            name,
            category: form.category.trim() || null,
            price,
            description: form.description.trim() || null,
            videoUrl: form.videoUrl.trim() || null,
            coverUrl: form.coverUrl.trim() || null,
            isBestseller: form.isBestseller,
            published: form.published,
          },
        },
      });
      setEditing(false);
      toast.success("Dish updated");
      router.invalidate();
    } catch {
      toast.error("Couldn't save changes");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${item.name}" from the menu? This can't be undone.`)) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: item.id } });
      setOpen(false);
      toast.success("Dish deleted");
      router.invalidate();
    } catch {
      toast.error("Couldn't delete the dish");
    } finally {
      setBusy(false);
    }
  }

  const showDraftBadge = canSeeDrafts && !item.published;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setEditing(false);
      }}
    >
      <DialogTrigger asChild>
        <button type="button" className="group block w-full cursor-pointer text-left">
          <Card
            className={cn(
              "overflow-hidden transition-all group-hover:border-foreground group-hover:shadow-neo",
              showDraftBadge && "opacity-60",
            )}
          >
            <div className="relative aspect-square overflow-hidden">
              {item.coverUrl ? (
                <img src={item.coverUrl} alt={item.name} className="h-full w-full object-cover" />
              ) : (
                <FallbackCover name={item.name} />
              )}
              <div className="absolute left-2 top-2 flex flex-col gap-1">
                {item.isBestseller ? (
                  <Badge tone="pop" className="border-foreground bg-gold text-ink">
                    Bestseller
                  </Badge>
                ) : null}
              </div>
              {showDraftBadge ? (
                <Badge tone="neutral" className="absolute right-2 top-2 bg-background/90">
                  Draft
                </Badge>
              ) : null}
            </div>
            <div className="border-t-2 border-foreground/15 px-3 py-2.5">
              <p className="truncate font-display text-lg uppercase text-foreground">{item.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {item.price ? formatGBP(item.price) : "—"}
              </p>
            </div>
          </Card>
        </button>
      </DialogTrigger>
      <DialogContent title={item.name} wide={editing}>
        {editing ? (
          <div className="flex flex-col gap-4">
            <MenuItemFormFields form={form} setForm={setForm} categories={categories} />
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={saveEdit}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {embed ? <VideoEmbed embed={embed} /> : null}
            {item.description ? (
              <p className="text-sm text-foreground">{item.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No recipe notes yet.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {item.category ? <Badge tone="outline">{item.category}</Badge> : null}
              {item.isBestseller ? (
                <Badge tone="pop" className="border-foreground bg-gold text-ink">
                  Bestseller
                </Badge>
              ) : null}
              {showDraftBadge ? <Badge tone="neutral">Draft</Badge> : null}
              <span className="ml-auto font-mono text-sm font-bold text-foreground">
                {item.price ? formatGBP(item.price) : "Price TBC"}
              </span>
            </div>
            {canManage ? (
              <div className="flex gap-2 border-t-2 border-foreground/15 pt-4">
                <Button variant="outline" className="flex-1" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button variant="destructive" disabled={busy} onClick={remove}>
                  <Trash2 /> Delete
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── page ─────────────────────────────────────────────────────────────────

function MenuPage() {
  const { actor } = Route.useRouteContext();
  const { items, categories } = Route.useLoaderData();
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const canManage = actor.role === "ceo";
  const canSeeDrafts = actor.role !== "staff";
  const filtered =
    activeCategory === "All" ? items : items.filter((i) => i.category === activeCategory);

  return (
    <div>
      <PageHeader
        kicker="Brand library — every site inherits this"
        title="The Menu"
        actions={canManage ? <AddDishDialog categories={categories} /> : null}
      />
      <p className="-mt-4 mb-6 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Train from the film — plate it the same at every site.
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="The brand library is empty — add the first dish."
          action={canManage ? <AddDishDialog categories={categories} /> : undefined}
        />
      ) : (
        <>
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            <CategoryChip
              label="All"
              active={activeCategory === "All"}
              onClick={() => setActiveCategory("All")}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c}
                label={c}
                active={activeCategory === c}
                onClick={() => setActiveCategory(c)}
              />
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={UtensilsCrossed}
              title="Nothing in this category yet"
              hint={`No dishes filed under “${activeCategory}”.`}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((item) => (
                <DishCard
                  key={item.id}
                  item={item}
                  canManage={canManage}
                  canSeeDrafts={canSeeDrafts}
                  categories={categories}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
