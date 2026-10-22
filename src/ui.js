'use strict';

/**
 * Paneles con Components V2 (el "embed v2" de Discord).
 *
 * Todo va dentro de un contenedor con la barra de color a la izquierda, y
 * dentro caben texto, separadores, imágenes, botones y menús. Un mensaje V2 no
 * puede llevar `content` ni `embeds`: solo el contenedor.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

class Panel {
  constructor(color) {
    this.contenedor = new ContainerBuilder().setAccentColor(color);
  }

  /** Imagen grande arriba del todo (GIF o PNG). Sin URL no hace nada. */
  banner(url) {
    if (!url) return this;
    this.contenedor.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(url)),
    );
    return this;
  }

  /** Título grande; si hay imagen, va pequeña a la derecha. */
  cabecera(titulo, { subtitulo, imagen } = {}) {
    const contenido = [`### ${titulo}`, subtitulo].filter(Boolean).join('\n');
    if (!imagen) return this.texto(contenido);
    this.contenedor.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(contenido))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(imagen)),
    );
    return this;
  }

  texto(contenido) {
    if (contenido) {
      this.contenedor.addTextDisplayComponents(new TextDisplayBuilder().setContent(contenido));
    }
    return this;
  }

  /** Texto con la barrita gris delante. */
  cita(contenido) {
    if (!contenido) return this;
    return this.texto(
      String(contenido)
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n'),
    );
  }

  /** Lista de [nombre, valor] → "**Nombre:** valor" */
  campos(lista) {
    return this.texto(
      lista
        .filter(Boolean)
        .map(([nombre, valor]) => `**${nombre}:** ${valor}`)
        .join('\n'),
    );
  }

  separador(grande = false) {
    this.contenedor.addSeparatorComponents(
      new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(grande ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small),
    );
    return this;
  }

  /** Fila de botones (máximo 5). */
  botones(...lista) {
    const validos = lista.flat().filter(Boolean);
    if (validos.length) {
      this.contenedor.addActionRowComponents(new ActionRowBuilder().addComponents(validos));
    }
    return this;
  }

  menu(select) {
    this.contenedor.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    return this;
  }

  /** Texto pequeño y gris al final. */
  pie(texto) {
    return this.texto(`-# ${texto}`);
  }

  /** Payload listo para reply / send / update. */
  mensaje({ efimero = false } = {}) {
    return {
      components: [this.contenedor],
      flags: efimero ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    };
  }
}

/** Botón gris con icono. `activo` lo pinta de color (para marcar la vista actual). */
function boton(id, etiqueta, emoji, activo = false) {
  const b = new ButtonBuilder()
    .setCustomId(id)
    .setLabel(etiqueta)
    .setStyle(activo ? ButtonStyle.Primary : ButtonStyle.Secondary);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/** Menú desplegable. opciones: [{ value, label, description?, emoji? }] */
function desplegable(id, placeholder, opciones, seleccionado) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .addOptions(
      opciones.map((o) => ({
        value: o.value,
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
        ...(o.emoji ? { emoji: o.emoji } : {}),
        default: o.value === seleccionado,
      })),
    );
}

/** Aviso corto: barra de color, título y texto. */
function aviso(color, titulo, cuerpo) {
  return new Panel(color).cabecera(titulo).texto(cuerpo);
}

module.exports = { Panel, boton, desplegable, aviso };
