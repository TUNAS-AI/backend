ALTER TABLE "public"."tunas_messages" ADD COLUMN "telegram_sent_at" TIMESTAMPTZ(6),
ADD COLUMN "telegram_message_id" TEXT;

CREATE TABLE "public"."telegram_connections" (
    "telegram_connection_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "telegram_user_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("telegram_connection_id")
);

CREATE TABLE "public"."telegram_link_tokens" (
    "telegram_link_token_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_tokens_pkey" PRIMARY KEY ("telegram_link_token_id")
);

CREATE TABLE "public"."telegram_actions" (
    "telegram_action_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "telegram_connection_id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "telegram_message_id" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_actions_pkey" PRIMARY KEY ("telegram_action_id")
);

CREATE UNIQUE INDEX "telegram_connections_user_id_key" ON "public"."telegram_connections"("user_id");
CREATE UNIQUE INDEX "telegram_connections_telegram_user_id_key" ON "public"."telegram_connections"("telegram_user_id");
CREATE UNIQUE INDEX "telegram_connections_telegram_chat_id_key" ON "public"."telegram_connections"("telegram_chat_id");
CREATE UNIQUE INDEX "telegram_link_tokens_user_id_key" ON "public"."telegram_link_tokens"("user_id");
CREATE UNIQUE INDEX "telegram_link_tokens_token_hash_key" ON "public"."telegram_link_tokens"("token_hash");
CREATE INDEX "telegram_link_tokens_expires_at_idx" ON "public"."telegram_link_tokens"("expires_at");
CREATE UNIQUE INDEX "telegram_actions_token_hash_key" ON "public"."telegram_actions"("token_hash");
CREATE INDEX "telegram_actions_telegram_connection_id_expires_at_idx" ON "public"."telegram_actions"("telegram_connection_id", "expires_at");
CREATE INDEX "telegram_actions_farm_id_mission_id_idx" ON "public"."telegram_actions"("farm_id", "mission_id");

ALTER TABLE "public"."telegram_connections" ADD CONSTRAINT "telegram_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."telegram_actions" ADD CONSTRAINT "telegram_actions_telegram_connection_id_fkey" FOREIGN KEY ("telegram_connection_id") REFERENCES "public"."telegram_connections"("telegram_connection_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."telegram_actions" ADD CONSTRAINT "telegram_actions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "public"."farms"("farm_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."telegram_actions" ADD CONSTRAINT "telegram_actions_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("mission_id") ON DELETE CASCADE ON UPDATE CASCADE;
