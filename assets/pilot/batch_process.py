# ============================================================================
#  batch_process.py — limpieza y decimado en lote de los 14 avatares.
#
#  Uso: abre Blender -> pestaña "Scripting" -> "New" -> pega este archivo
#  entero -> botón ▶ (Run Script). Mira la Consola del Sistema
#  (Window > Toggle System Console, en Windows) para ver el progreso.
#
#  v2: la primera versión usaba bpy.ops.wm.read_factory_settings() para
#  vaciar la escena entre archivo y archivo — eso rompe el contexto de
#  Blender a media ejecución del script (ventana/pantalla se reconstruyen
#  y las llamadas siguientes ya no encuentran objeto activo). Aquí se
#  vacía la escena "a mano" (borrando objetos/datos uno a uno) sin tocar
#  la ventana, y las operaciones de soldado/suavizado van directo por la
#  API de datos (bmesh) en vez de por operadores que dependen de tener
#  un viewport 3D activo — así no importa si el contexto en el momento de
#  ejecutar el script es el editor de texto y no un viewport.
#
#  Qué hace, por cada archivo de SRC_FILES:
#    1. Vacía la escena (sin resetear Blender entero).
#    2. Importa el .glb.
#    3. Suelda vértices casi-duplicados (equivalente a Merge by Distance).
#    4. Sombrea suave (equivalente a Shade Smooth).
#    5. Si supera el presupuesto de triángulos, decima con el ratio justo.
#    6. Exporta a assets/pilot/procesado/<mismo nombre>, conservando las
#       texturas horneadas.
#
#  Los originales en SRC_DIR no se tocan — todo sale a "procesado" al lado.
# ============================================================================

import bpy
import bmesh
import os

SRC_DIR = r"C:\Users\JC\Documents\circuito-diario\assets\pilot"
OUT_DIR = os.path.join(SRC_DIR, "procesado")

TARGETS = {
    "avatar_base.glb": 20000,
    "avatar_comun_1.glb": 12000,
    "avatar_comun_2.glb": 12000,
    "avatar_comun_3.glb": 12000,
    "avatar_comun_4.glb": 12000,
    "avatar_comun_5.glb": 12000,
    "avatar_comun_6.glb": 12000,
    "avatar_raro_1.glb": 16000,
    "avatar_raro_2.glb": 16000,
    "avatar_raro_3.glb": 16000,
    "avatar_raro_4.glb": 16000,
    "avatar_epico_1.glb": 22000,
    "avatar_epico_2.glb": 22000,
    "avatar_legendario.glb": 45000,
}

os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)


def weld_and_smooth(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    for poly in obj.data.polygons:
        poly.use_smooth = True


def process_one(fname, target_tris):
    filepath = os.path.join(SRC_DIR, fname)
    if not os.path.exists(filepath):
        print(f"[SKIP] no existe: {filepath}")
        return

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=filepath)

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not mesh_objs:
        print(f"[SKIP] sin mallas: {fname}")
        return

    for obj in mesh_objs:
        weld_and_smooth(obj)

        current_tris = len(obj.data.polygons)
        if current_tris > target_tris:
            ratio = target_tris / current_tris
            mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
            mod.ratio = ratio
            with bpy.context.temp_override(
                object=obj, active_object=obj,
                selected_objects=[obj], selected_editable_objects=[obj],
            ):
                bpy.ops.object.modifier_apply(modifier=mod.name)
            final_tris = len(obj.data.polygons)
        else:
            final_tris = current_tris

        print(f"  {obj.name}: {current_tris} -> {final_tris} tris (objetivo {target_tris})")

    out_path = os.path.join(OUT_DIR, fname)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB")
    print(f"[OK] {fname} -> {out_path}\n")


print(f"=== Procesando {len(TARGETS)} avatares ===\n")
for fname, target in TARGETS.items():
    print(f"--- {fname} (objetivo {target} tris) ---")
    process_one(fname, target)

print("=== Listo. Revisa la carpeta 'procesado' antes de avisarme. ===")
