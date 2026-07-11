-- Seed default inventory products
INSERT INTO inventory (id, name, price, stock, threshold, enabled, image)
VALUES
  (1, 'Mechanical Keyboard', 2350, 15, 5, true, ''),
  (2, 'Gaming Mouse', 1650, 20, 8, true, ''),
  (3, '27" Monitor', 8500, 8, 3, true, ''),
  (4, 'Laptop Stand', 1200, 12, 5, true, ''),
  (5, 'Gaming Headset', 2800, 6, 4, true, ''),
  (6, 'Webcam HD', 1800, 10, 5, true, ''),
  (7, 'Bluetooth Speaker', 1450, 14, 6, true, ''),
  (8, 'SSD 1TB', 3200, 18, 5, true, ''),
  (9, 'USB-C Hub', 850, 25, 10, true, ''),
  (10, 'Printer', 4500, 5, 3, true, ''),
  (11, 'Mouse Pad', 250, 30, 15, true, ''),
  (12, 'Extension Cord', 350, 22, 10, true, '')
ON CONFLICT (id) DO NOTHING;

-- Enable identity column to accept explicit ids (run only once)
SELECT setval('inventory_id_seq', 12);
