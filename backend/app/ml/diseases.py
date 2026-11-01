"""Catálogo de clases (dataset 'Tomato Leaf Disease') con info en español para los reportes."""

DISEASES = {
    "healthy": {
        "label": "Hoja sana",
        "pathogen": None,
        "description": "La hoja no presenta síntomas visibles de enfermedad.",
        "recommendations": [
            "Mantener el monitoreo periódico con el robot.",
            "Conservar buena ventilación y riego al pie (evitar mojar el follaje).",
        ],
    },
    "Bacterial_spot": {
        "label": "Mancha bacteriana",
        "pathogen": "Xanthomonas spp.",
        "description": "Pequeñas manchas oscuras y acuosas con halo amarillo; se propaga con salpicaduras de agua.",
        "recommendations": [
            "Eliminar y destruir hojas afectadas.",
            "Aplicar productos a base de cobre según recomendación técnica.",
            "Evitar riego por aspersión y trabajar las plantas mojadas.",
        ],
    },
    "Early_blight": {
        "label": "Tizón temprano",
        "pathogen": "Alternaria solani",
        "description": "Manchas marrones con anillos concéntricos ('diana'), empieza en hojas bajas.",
        "recommendations": [
            "Retirar hojas basales infectadas.",
            "Fungicida preventivo (clorotalonil, mancozeb) según etiqueta.",
            "Rotación de cultivos y acolchado para evitar salpicaduras de suelo.",
        ],
    },
    "Late_blight": {
        "label": "Tizón tardío",
        "pathogen": "Phytophthora infestans",
        "description": "Lesiones grandes, oscuras y aceitosas; avanza muy rápido con humedad alta. Urgente.",
        "recommendations": [
            "Actuar de inmediato: aislar y eliminar plantas muy afectadas.",
            "Fungicida sistémico específico para oomicetos (consultar agrónomo).",
            "Reducir humedad: espaciamiento, poda y riego por goteo.",
        ],
    },
    "Leaf_Mold": {
        "label": "Moho de la hoja",
        "pathogen": "Passalora fulva",
        "description": "Manchas amarillas en el haz y moho verde oliva en el envés; típico de invernadero.",
        "recommendations": [
            "Mejorar ventilación y bajar la humedad relativa.",
            "Eliminar hojas afectadas.",
            "Usar variedades resistentes en próximos ciclos.",
        ],
    },
    "Septoria_leaf_spot": {
        "label": "Septoriosis (mancha foliar)",
        "pathogen": "Septoria lycopersici",
        "description": "Muchas manchas pequeñas circulares con centro gris y borde oscuro.",
        "recommendations": [
            "Eliminar hojas bajas afectadas.",
            "Fungicida protector y evitar mojar el follaje.",
            "Limpiar restos de cosecha.",
        ],
    },
    "Spider_mites_Two-spotted_spider_mite": {
        "label": "Araña roja (ácaros)",
        "pathogen": "Tetranychus urticae",
        "description": "Punteado amarillento, telarañas finas en el envés; favorecido por calor y sequía.",
        "recommendations": [
            "Revisar el envés de las hojas.",
            "Acaricida o jabón potásico; control biológico con ácaros depredadores.",
            "Aumentar humedad ambiental.",
        ],
    },
    "Target_Spot": {
        "label": "Mancha diana",
        "pathogen": "Corynespora cassiicola",
        "description": "Lesiones marrones con anillos concéntricos y centro claro.",
        "recommendations": [
            "Poda para mejorar aireación.",
            "Fungicida según recomendación técnica.",
            "Eliminar residuos infectados.",
        ],
    },
    "Tomato_mosaic_virus": {
        "label": "Virus del mosaico del tomate",
        "pathogen": "ToMV",
        "description": "Mosaico verde claro/oscuro, hojas deformadas. Se transmite por contacto y herramientas.",
        "recommendations": [
            "Eliminar plantas infectadas (no tiene cura).",
            "Desinfectar herramientas y manos.",
            "Usar semilla certificada y variedades resistentes.",
        ],
    },
    "Tomato_Yellow_Leaf_Curl_Virus": {
        "label": "Virus del rizado amarillo (TYLCV)",
        "pathogen": "TYLCV (transmitido por mosca blanca)",
        "description": "Hojas pequeñas, enrolladas hacia arriba y amarillentas; planta achaparrada.",
        "recommendations": [
            "Controlar la mosca blanca (trampas amarillas, mallas).",
            "Eliminar plantas infectadas.",
            "Variedades tolerantes a TYLCV.",
        ],
    },
}


def normalize_class(name: str) -> str:
    """'Tomato___Late_blight' → 'Late_blight'; 'Tomato___healthy' → 'healthy'."""
    n = name.split("___")[-1].strip().replace(" ", "_")
    if n.lower() in ("healthy", "sana", "tomato_healthy"):
        return "healthy"
    return n


def info(cls: str) -> dict:
    return DISEASES.get(cls, {"label": cls.replace("_", " "), "pathogen": None,
                              "description": "", "recommendations": []})
