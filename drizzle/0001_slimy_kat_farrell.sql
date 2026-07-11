CREATE TABLE "stock_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stock_item_id" uuid NOT NULL,
	"quantity_ordered" numeric NOT NULL,
	"quantity_sent" numeric,
	"quantity_received" numeric,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "stock_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"note" text,
	"placed_by" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"sent_note" text,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_order_items" ADD CONSTRAINT "stock_order_items_order_id_stock_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."stock_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order_items" ADD CONSTRAINT "stock_order_items_stock_item_id_stock_items_id_fk" FOREIGN KEY ("stock_item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_placed_by_members_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_sent_by_members_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_orders" ADD CONSTRAINT "stock_orders_received_by_members_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;