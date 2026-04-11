-- MySQL dump 10.13  Distrib 9.6.0, for macos26.3 (arm64)
--
-- Host: 127.0.0.1    Database: wa_crm_v2
-- ------------------------------------------------------
-- Server version	9.6.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '2e34a5de-33ed-11f1-b407-e0719289f944:1-19576';

--
-- Table structure for table `audit_log`
--

DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `table_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `record_id` int DEFAULT NULL,
  `operator` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT 'system',
  `before_value` json DEFAULT NULL,
  `after_value` json DEFAULT NULL,
  `ip_address` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `client_memory`
--

DROP TABLE IF EXISTS `client_memory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_memory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `memory_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''preference''|''decision''|''style''|''policy''',
  `memory_key` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `memory_value` text COLLATE utf8mb4_unicode_ci,
  `source_record_id` int DEFAULT NULL,
  `confidence` int DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_client_mem` (`client_id`,`memory_type`,`memory_key`),
  KEY `idx_cm_client` (`client_id`)
) ENGINE=InnoDB AUTO_INCREMENT=171 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `client_profiles`
--

DROP TABLE IF EXISTS `client_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `tags` json DEFAULT NULL COMMENT 'JSON array',
  `tiktok_data` json DEFAULT NULL COMMENT '{followers, avg_views, gmv}',
  `stage` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_interaction` datetime DEFAULT NULL,
  `last_updated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_id` (`client_id`),
  KEY `idx_cp_client` (`client_id`)
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `client_tags`
--

DROP TABLE IF EXISTS `client_tags`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `client_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tag` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '如 "tone:formal"',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''ai_extracted''|''sft_feedback''|''keeper_update''|''manual''',
  `confidence` int DEFAULT '1' COMMENT '1-3 置信度',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tag` (`client_id`,`tag`,`source`),
  KEY `idx_ct_client` (`client_id`),
  KEY `idx_ct_tag` (`tag`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `creator_aliases`
--

DROP TABLE IF EXISTS `creator_aliases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `creator_aliases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `alias_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'wa_phone|wa_name|keeper_user|tiktok|jb_name|email',
  `alias_value` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_verified` tinyint(1) DEFAULT '0',
  `matched_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alias` (`alias_type`,`alias_value`),
  KEY `idx_aliases_creator` (`creator_id`),
  CONSTRAINT `creator_aliases_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=15977 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `creators`
--

DROP TABLE IF EXISTS `creators`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `creators` (
  `id` int NOT NULL AUTO_INCREMENT,
  `primary_name` text COLLATE utf8mb4_unicode_ci,
  `wa_phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keeper_username` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Keeper用户名',
  `wa_owner` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'Beau' COMMENT '负责人 Beau/Yiyun',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'unknown' COMMENT '数据来源',
  `is_active` tinyint(1) DEFAULT '1' COMMENT '是否活跃',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `wa_phone` (`wa_phone`),
  UNIQUE KEY `keeper_username` (`keeper_username`),
  KEY `idx_creators_phone` (`wa_phone`),
  KEY `idx_creators_keeper` (`keeper_username`),
  KEY `idx_creators_owner` (`wa_owner`)
) ENGINE=InnoDB AUTO_INCREMENT=2417 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `event_periods`
--

DROP TABLE IF EXISTS `event_periods`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `event_periods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_id` int NOT NULL,
  `period_start` datetime NOT NULL,
  `period_end` datetime NOT NULL,
  `video_count` int DEFAULT '0',
  `bonus_earned` double DEFAULT '0',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'pending' COMMENT '''pending''|''settled''',
  `meta` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_periods_event` (`event_id`),
  CONSTRAINT `event_periods_ibfk_1` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `event_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''trial_7day''|''monthly_challenge''|''agency_bound''',
  `event_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''challenge''|''gmv''|''referral''|''incentive_task''|''agency''',
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''Beau''|''Yiyun''',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'active' COMMENT '''pending''|''active''|''completed''|''cancelled''',
  `trigger_source` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'semantic_auto' COMMENT '''semantic_auto''|''manual''|''gmv_crosscheck''',
  `trigger_text` text COLLATE utf8mb4_unicode_ci,
  `start_at` datetime DEFAULT NULL,
  `end_at` datetime DEFAULT NULL,
  `meta` json DEFAULT NULL COMMENT '事件特定数据',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_events_unique_active` (`creator_id`,`event_key`,`status`,(if((`status` = _utf8mb4'active'),0,1))),
  KEY `idx_events_creator` (`creator_id`),
  KEY `idx_events_status` (`status`),
  KEY `idx_events_owner` (`owner`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=275 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `events_policy`
--

DROP TABLE IF EXISTS `events_policy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `events_policy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `owner` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `policy_json` json NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_policy` (`owner`,`event_key`)
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `generation_log`
--

DROP TABLE IF EXISTS `generation_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `generation_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retrieval_snapshot_id` bigint DEFAULT NULL,
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `route` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'minimax',
  `ab_bucket` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scene` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT 'unknown',
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `temperature_json` json DEFAULT NULL,
  `message_count` int DEFAULT '0',
  `prompt_version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `latency_ms` int DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'success',
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_gl_client_created` (`client_id`,`created_at`),
  KEY `idx_gl_status_created` (`status`,`created_at`),
  KEY `idx_gl_snapshot` (`retrieval_snapshot_id`)
) ENGINE=InnoDB AUTO_INCREMENT=287 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `joinbrands_link`
--

DROP TABLE IF EXISTS `joinbrands_link`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `joinbrands_link` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `creator_name_jb` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jb_gmv` double DEFAULT '0',
  `jb_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'unknown',
  `jb_priority` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `jb_next_action` text COLLATE utf8mb4_unicode_ci,
  `last_message` bigint DEFAULT NULL,
  `days_since_msg` int DEFAULT '999',
  `invite_code_jb` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ev_joined` tinyint(1) DEFAULT '0',
  `ev_ready_sent` tinyint(1) DEFAULT '0',
  `ev_trial_7day` tinyint(1) DEFAULT '0' COMMENT '旧字段，兼容',
  `ev_trial_active` tinyint(1) DEFAULT '0',
  `ev_monthly_started` tinyint(1) DEFAULT '0',
  `ev_monthly_invited` tinyint(1) DEFAULT '0',
  `ev_monthly_joined` tinyint(1) DEFAULT '0',
  `ev_whatsapp_shared` tinyint(1) DEFAULT '0',
  `ev_gmv_1k` tinyint(1) DEFAULT '0',
  `ev_gmv_2k` tinyint(1) DEFAULT '0',
  `ev_gmv_5k` tinyint(1) DEFAULT '0',
  `ev_gmv_10k` tinyint(1) DEFAULT '0',
  `ev_agency_bound` tinyint(1) DEFAULT '0',
  `ev_churned` tinyint(1) DEFAULT '0',
  `last_synced` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `creator_id` (`creator_id`),
  KEY `idx_jb_creator` (`creator_id`),
  CONSTRAINT `joinbrands_link_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=378 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `keeper_link`
--

DROP TABLE IF EXISTS `keeper_link`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `keeper_link` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `keeper_username` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keeper_gmv` double DEFAULT '0',
  `keeper_gmv30` double DEFAULT '0',
  `keeper_orders` int DEFAULT '0',
  `keeper_videos` int DEFAULT '0',
  `keeper_videos_posted` int DEFAULT '0',
  `keeper_videos_sold` int DEFAULT '0',
  `keeper_card_rate` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keeper_order_rate` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keeper_reg_time` bigint DEFAULT NULL,
  `keeper_activate_time` bigint DEFAULT NULL,
  `last_synced` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `creator_id` (`creator_id`),
  UNIQUE KEY `keeper_username` (`keeper_username`),
  KEY `idx_keeper_creator` (`creator_id`),
  KEY `idx_keeper_username` (`keeper_username`),
  CONSTRAINT `keeper_link_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4634 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `manual_match`
--

DROP TABLE IF EXISTS `manual_match`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `manual_match` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int DEFAULT NULL,
  `keeper_username` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `joinbrands_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wa_phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'manual',
  `matched_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_match` (`keeper_username`,`joinbrands_name`,`wa_phone`),
  KEY `creator_id` (`creator_id`),
  CONSTRAINT `manual_match_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `operator_creator_roster`
--

DROP TABLE IF EXISTS `operator_creator_roster`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `operator_creator_roster` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_file` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_poc` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_handle` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_keeper_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `marketing_channel` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `match_strategy` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `score` int DEFAULT '0',
  `is_primary` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ocr_creator` (`creator_id`),
  UNIQUE KEY `uk_ocr_operator_raw` (`operator`,`raw_name`(96),`raw_handle`(96),`raw_keeper_name`(96)),
  KEY `idx_ocr_operator` (`operator`),
  KEY `idx_ocr_session` (`session_id`),
  CONSTRAINT `fk_ocr_creator` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=314 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `operator_experiences`
--

DROP TABLE IF EXISTS `operator_experiences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `operator_experiences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `system_prompt_base` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `scene_config` json DEFAULT NULL COMMENT 'scene → prompt fragment',
  `forbidden_rules` json DEFAULT NULL COMMENT 'JSON array',
  `is_active` tinyint(1) DEFAULT '1',
  `priority` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `operator` (`operator`),
  KEY `idx_oe_operator` (`operator`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `policy_documents`
--

DROP TABLE IF EXISTS `policy_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `policy_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `policy_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `policy_version` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `policy_content` json NOT NULL,
  `applicable_scenarios` json DEFAULT NULL COMMENT 'JSON array',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `policy_key` (`policy_key`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `retrieval_snapshot`
--

DROP TABLE IF EXISTS `retrieval_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `retrieval_snapshot` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scene` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT 'unknown',
  `system_prompt_version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'v2',
  `snapshot_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grounding_json` json NOT NULL,
  `topic_context` text COLLATE utf8mb4_unicode_ci,
  `rich_context` text COLLATE utf8mb4_unicode_ci,
  `conversation_summary` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rs_client_scene` (`client_id`,`scene`,`created_at`),
  KEY `idx_rs_hash` (`snapshot_hash`)
) ENGINE=InnoDB AUTO_INCREMENT=270 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sft_feedback`
--

DROP TABLE IF EXISTS `sft_feedback`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sft_feedback` (
  `id` int NOT NULL AUTO_INCREMENT,
  `client_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `feedback_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''skip''|''reject''|''edit''',
  `input_text` text COLLATE utf8mb4_unicode_ci,
  `opt1` text COLLATE utf8mb4_unicode_ci,
  `opt2` text COLLATE utf8mb4_unicode_ci,
  `final_output` text COLLATE utf8mb4_unicode_ci,
  `scene` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `reject_reason` text COLLATE utf8mb4_unicode_ci COMMENT 'skip/reject 时：为什么两个候选都不够好',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_feedback_dedup` (`client_id`,`feedback_type`,`created_at`),
  KEY `idx_feedback_type_scene` (`feedback_type`,`scene`),
  KEY `idx_feedback_client` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sft_memory`
--

DROP TABLE IF EXISTS `sft_memory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sft_memory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `model_opt1` text COLLATE utf8mb4_unicode_ci,
  `model_opt2` text COLLATE utf8mb4_unicode_ci,
  `human_selected` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''opt1''|''opt2''|''custom''',
  `human_output` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `model_predicted` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model_rejected` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_custom_input` tinyint(1) DEFAULT '0',
  `human_reason` text COLLATE utf8mb4_unicode_ci,
  `context_json` json DEFAULT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'approved',
  `reviewed_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `similarity` int DEFAULT NULL,
  `scene` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message_history` json DEFAULT NULL COMMENT '前10轮对话历史',
  `system_prompt_version` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'v1',
  `client_id_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA256(client_id)',
  `input_text_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA256(input_text)',
  `human_output_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA256(human_output)',
  `created_date` date DEFAULT NULL COMMENT 'YYYY-MM-DD',
  `chosen_output` text COLLATE utf8mb4_unicode_ci COMMENT '被选中的回复（RLHF Preference Pair）',
  `rejected_output` text COLLATE utf8mb4_unicode_ci COMMENT '被拒绝的回复（RLHF Preference Pair）',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_sft_dedup` (`client_id_hash`,`input_text_hash`,`human_output_hash`,`created_date`,`system_prompt_version`),
  KEY `idx_sft_created` (`created_at`),
  KEY `idx_sft_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=645 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sync_log`
--

DROP TABLE IF EXISTS `sync_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sync_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bot_name` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_count` int DEFAULT NULL,
  `synced_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'success',
  `note` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `training_log`
--

DROP TABLE IF EXISTS `training_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `training_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `month_label` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_count` int NOT NULL,
  `export_path` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail` text COLLATE utf8mb4_unicode_ci,
  `triggered_by` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'manual',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wa_crm_data`
--

DROP TABLE IF EXISTS `wa_crm_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_crm_data` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `priority` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT 'low',
  `next_action` text COLLATE utf8mb4_unicode_ci,
  `event_score` double DEFAULT '0',
  `urgency_level` int DEFAULT '5',
  `monthly_fee_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `monthly_fee_amount` double DEFAULT '20',
  `monthly_fee_deducted` int DEFAULT '0',
  `beta_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT 'not_introduced',
  `beta_cycle_start` bigint DEFAULT NULL,
  `beta_program_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT '20_day_beta',
  `agency_bound` tinyint(1) DEFAULT '0',
  `agency_bound_at` bigint DEFAULT NULL,
  `agency_deadline` bigint DEFAULT NULL,
  `video_count` int DEFAULT '0',
  `video_target` int DEFAULT '35',
  `video_last_checked` bigint DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `creator_id` (`creator_id`),
  KEY `idx_crm_creator` (`creator_id`),
  CONSTRAINT `wa_crm_data_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3913 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wa_messages`
--

DROP TABLE IF EXISTS `wa_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `wa_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '''me''|''user''|''assistant''',
  `operator` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '''Beau''|''Yiyun''|''WangYouKe''等',
  `text` text COLLATE utf8mb4_unicode_ci,
  `timestamp` bigint DEFAULT NULL COMMENT 'Unix timestamp (ms)',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `message_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'SHA256(role|text|timestamp_ms)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_messages_dedup_hash` (`creator_id`,`message_hash`),
  KEY `idx_messages_creator` (`creator_id`),
  KEY `idx_messages_timestamp` (`timestamp`),
  CONSTRAINT `wa_messages_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `creators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=71705 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'wa_crm_v2'
--
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-11 18:40:59
