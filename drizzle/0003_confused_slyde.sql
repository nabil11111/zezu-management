CREATE TABLE "warehouse_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"quantity" numeric,
	"supplier" text,
	"available" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "welcome_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_order_items" ADD COLUMN "warehouse_product_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD COLUMN "issue_reason" text;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD COLUMN "issue_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD COLUMN "issue_resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "stock_order_items" ADD CONSTRAINT "stock_order_items_warehouse_product_id_warehouse_products_id_fk" FOREIGN KEY ("warehouse_product_id") REFERENCES "public"."warehouse_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_issue_resolved_by_members_id_fk" FOREIGN KEY ("issue_resolved_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;