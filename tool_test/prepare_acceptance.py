"""Build the acceptance project from original notes, without using old render code."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = Path('C:/Users/31305/Documents/workspace/video-creator/wxq_anqila/script.md')
notes = SOURCE.read_text(encoding='utf-8-sig')

def text(id, value, size=32, bold=False, color='#EAEAF2'):
    return {'id': id, 'type': 'text', 'text': value,
            'style': {'fontSize': size, 'bold': bold, 'color': color}}

def cards(id, items, kind='hero', height=170):
    crop = {'x': 20, 'y': 32, 'width': 364, 'height': 269} if kind == 'hero' else {'x': 78, 'y': 49, 'width': 248, 'height': 238}
    return {'id': id, 'type': 'group', 'layout': {'type': 'row', 'gap': 18},
            'elements': [{'id': id+'_'+str(i), 'type': 'group',
                          'layout': {'type': 'column', 'gap': 10, 'padding': 12},
                          'style': {'background': '#232D43'},
                          'elements': [{'id': id+'_'+str(i)+'_image', 'type': 'image',
                                        'height': height, 'assetQuery': {'name': asset},
                                        'fit': 'contain', 'crop': crop},
                                       text(id+'_'+str(i)+'_label', label, 28)]}
                         for i, (asset, label) in enumerate(items)]}

def module(id, title, elements):
    return {'id': id, 'title': title, 'layout': {'type': 'column', 'padding': 24, 'gap': 20}, 'elements': elements}

project = {
    'image-create-tool-version': 'v0.0.1', 'assetsDir': 'assets/', 'outputsDir': 'outputs/',
    'documentId': 'acceptance-miyue', 'revision': 1, 'title': '安琪拉 · 逐鹿芈月c',
    'sourceNotes': notes,
    'modules': [
        module('overview', '01 · 安琪拉 / 逐鹿芈月c', [
            text('title', '安琪拉 · 逐鹿芈月c', 60, True, '#C2A0FF'),
            text('general_note', '3级的神秘力量获取方式决定我们这局玩什么'),
            text('stance', '烂分阵容，保上分，很难第一，ban河洛推荐（怕钟馗）'),
            text('restriction', '有逐鹿同行不建议玩，觉醒牌推荐等觉醒了芈月之后再打一波爆发'),
            text('talents_note', '推荐的顿悟时刻：奇想阵营，奇想英雄牌，奇想胜利', 32, True),
            {'id': 'talents', 'type': 'group', 'layout': {'type': 'row', 'gap': 20}, 'elements': [
                {'id': 'talent_'+str(i), 'type': 'itemRow', 'text': label,
                 'image': {'assetQuery': {'name': asset}, 'width': 76, 'height': 76, 'fit': 'contain'},
                 'style': {'fontSize': 28, 'padding': 16, 'gap': 16}}
                for i, (asset, label) in enumerate([('奇想·阵营', '奇想阵营'), ('奇想·英雄牌', '奇想英雄牌'), ('奇想·胜利', '奇想胜利')])]},
        ]),
        module('operation', '02 · 前期开局与运营', [
            text('table_route', '速3 d觉醒芈月，然后升4觉醒西施', 36, True),
            text('opening', '前期开局\n干将，牛，奕星打连胜'),
            cards('opening_heroes', [('干将莫邪', '干将'), ('牛魔', '牛'), ('弈星', '奕星')], height=155),
            text('level_three', '速升3级，3级d 觉醒芈月'),
            text('tools_note', '其他工具卡，白起，西施'),
            cards('core_heroes', [('芈月', '芈月'), ('白起', '白起'), ('西施', '西施')], height=185),
        ]),
        module('equipment', '03 · 装备说明', [
            text('equipment_note', '装备说明，必要苍穹，推荐大书，最后一个可选择吸血书，聚灵法杖，磐岩之心（针对海月）'),
            cards('equipment_core', [('纯净苍穹', '苍穹'), ('贤者之书', '大书'), ('噬神之书', '吸血书')], 'equip', 130),
            cards('equipment_optional', [('聚灵法杖', '聚灵法杖'), ('磐石之心', '磐岩之心（针对海月）')], 'equip', 130),
        ]),
        module('support', '04 · 可选辅助', [
            text('support_note', '可选辅助，小明（来的多才考虑，比如一次性来了两个），瑶（不ban大河推荐上），太乙（后期必上），钟馗（针对单c对手），老夫子（打合成给战术牌）'),
            cards('support_one', [('明世隐', '小明'), ('瑶', '瑶'), ('太乙真人', '太乙')], height=155),
            cards('support_two', [('钟馗', '钟馗'), ('老夫子', '老夫子')], height=155),
        ]),
    ],
    'composition': {'width': 1600, 'height': 'auto', 'background': '#101521', 'padding': 32, 'gap': 24},
}
(ROOT/'pjt.json').write_text(json.dumps(project, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print('Prepared', ROOT/'pjt.json')
