import os
import shutil
import random

SOURCE_DIR = 'model_files'
DEST_DIR = 'model_files/dataset'
TRAIN_RATIO = 0.8
SEED = 42

class_map = {
    'Tomato_healthy': 'Healthy',
    'Tomato_Late_blight': 'Late_blight'
}

for split in ['train', 'val']:
    for class_name in class_map.values():
        os.makedirs(os.path.join(DEST_DIR, split, class_name), exist_ok=True)

random.seed(SEED)

for src_folder, class_name in class_map.items():
    src_path = os.path.join(SOURCE_DIR, src_folder)

    if not os.path.exists(src_path):
        print(f" Carpeta no encontrada: {src_path}")
        continue

    images = [
        f for f in os.listdir(src_path)
        if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))
    ]

    random.shuffle(images)

    split_index = int(len(images) * TRAIN_RATIO)
    train_imgs = images[:split_index]
    val_imgs = images[split_index:]

    for img in train_imgs:
        shutil.copy2(
            os.path.join(src_path, img),
            os.path.join(DEST_DIR, 'train', class_name, img)
        )

    for img in val_imgs:
        shutil.copy2(
            os.path.join(src_path, img),
            os.path.join(DEST_DIR, 'val', class_name, img)
        )

    print(f"✔ {src_folder}: {len(train_imgs)} train, {len(val_imgs)} val")

print(" Dataset preparado en model_files/dataset")