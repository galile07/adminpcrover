ALTER TABLE inventory ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- Seed default inventory products
INSERT INTO inventory (id, name, description, price, stock, threshold, enabled, image)
VALUES
  (1, 'Mechanical Keyboard', 'Tactile mechanical keyboard with blue switches for responsive typing.', 2350, 15, 5, true, ''),
  (2, 'Gaming Mouse', 'High-precision optical gaming mouse with customizable RGB lighting.', 1650, 20, 8, true, ''),
  (3, '27" Monitor', 'Full HD 27-inch IPS monitor with slim bezels for immersive viewing.', 8500, 8, 3, true, ''),
  (4, 'Laptop Stand', 'Adjustable aluminum laptop stand for better posture and heat dissipation.', 1200, 12, 5, true, ''),
  (5, 'Gaming Headset', 'Surround-sound gaming headset with noise-canceling microphone.', 2800, 6, 4, true, ''),
  (6, 'Webcam HD', '1080p HD webcam with built-in microphone for video calls and streaming.', 1800, 10, 5, true, ''),
  (7, 'Bluetooth Speaker', 'Portable Bluetooth speaker with deep bass and 12-hour battery life.', 1450, 14, 6, true, ''),
  (8, 'SSD 1TB', 'High-speed 1TB SSD for faster boot times and file transfers.', 3200, 18, 5, true, ''),
  (9, 'USB-C Hub', '7-in-1 USB-C hub with HDMI, USB 3.0, SD card reader, and PD charging.', 850, 25, 10, true, ''),
  (10, 'Printer', 'Wireless all-in-one printer with scan, copy, and print capabilities.', 4500, 5, 3, true, ''),
  (11, 'Mouse Pad', 'Large cloth gaming mouse pad with stitched edges and non-slip base.', 250, 30, 15, true, ''),
  (12, 'Extension Cord', 'Heavy-duty 6-outlet extension cord with surge protection and 2m cable.', 350, 22, 10, true, '')
ON CONFLICT (id) DO NOTHING;

-- Enable identity column to accept explicit ids (run only once)
SELECT setval('inventory_id_seq', 12);
